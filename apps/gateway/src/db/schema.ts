import type { ConnectorManifest } from '@mcp-outlet/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// 명세의 도메인 모델 (User, Connector, Credential, Endpoint, AuditLog, ActivityLog)

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const connectorRuntime = pgEnum('connector_runtime', ['remote', 'builtin', 'stdio']);
// pending: 업스트림 OAuth 동의 전에 먼저 저장한 상태
export const connectorStatus = pgEnum('connector_status', [
  'pending',
  'ok',
  'error',
  'reauth_required',
]);
// 연결 테스트 실패 분류. 화면에는 분류만 보여주고 원문은 남기지 않는다 (F-RUN-03)
export const connectionTestResult = pgEnum('connection_test_result', [
  'ok',
  'private_address',
  'unreachable',
  'auth_failed',
  'not_mcp',
  'timeout',
  'redirect',
]);
export const credentialScope = pgEnum('credential_scope', ['global', 'user']);
export const callResult = pgEnum('call_result', ['ok', 'error', 'denied']);
export const activityAction = pgEnum('activity_action', [
  'connector.disable',
  'connector.enable',
  'client_secret.view',
]);
export const activityTarget = pgEnum('activity_target', ['connector', 'oauth_client']);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  sub: text().notNull().unique(),
  email: text(),
  // 로그인마다 IdP 클레임으로 갱신
  groups: text().array().notNull().default(sql`'{}'::text[]`),
  role: userRole().notNull().default('user'),
  lastLoginAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

// 관리 UI 로그인 세션. 쿠키에는 무작위 토큰을 두고 DB에는 그 SHA-256만 저장한다.
// 행을 지우면 바로 로그아웃된다 (권한 회수·강제 만료)
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // 요청 때 갱신하되 최대 1분에 한 번
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.userId), index().on(t.expiresAt)],
);

// owner가 없으면 전역, 있으면 개인 커넥터
export const connectors = pgTable(
  'connectors',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    runtime: connectorRuntime().notNull(),
    // 실행 정보·업스트림 인증·자격증명 스키마는 매니페스트 그대로 보관
    manifest: jsonb().$type<ConnectorManifest>().notNull(),
    visibleGroups: text().array().notNull().default(sql`'{}'::text[]`),
    toolsCache: jsonb().$type<unknown[]>(),
    toolsCachedAt: timestamp({ withTimezone: true }),
    status: connectorStatus().notNull().default('pending'),
    lastTestedAt: timestamp({ withTimezone: true }),
    lastTestResult: connectionTestResult(),
    // 관리자 사용 중지. 켜져 있으면 이 커넥터의 엔드포인트는 호출을 거부한다
    disabledAt: timestamp({ withTimezone: true }),
    disabledBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    disabledReason: text(),
    // 호출마다 갱신하지 않고 최대 1분에 한 번
    lastCalledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index().on(t.ownerId),
    check('personal_connector_runtime', sql`${t.ownerId} is null or ${t.runtime} <> 'stdio'`),
    check('disabled_reason', sql`(${t.disabledAt} is null) = (${t.disabledReason} is null)`),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: uuid().primaryKey().defaultRandom(),
    connectorId: uuid()
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    scope: credentialScope().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    // 필드 값(업스트림 OAuth면 refresh token 포함)을 JSON으로 묶어 암호화한 값
    ciphertext: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique().on(t.connectorId, t.userId).nullsNotDistinct(),
    check('credential_scope_owner', sql`(${t.scope} = 'global') = (${t.userId} is null)`),
  ],
);

export const endpoints = pgTable(
  'endpoints',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectorId: uuid()
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    allowedTools: text().array().notNull().default(sql`'{}'::text[]`),
    // 허용목록을 저장하거나 "새 툴 확인함"을 누른 시점의 커넥터 툴 이름 전체. 새 툴 = 현재 툴 − knownTools
    knownTools: text().array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean().notNull().default(true),
    lastCalledAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.ownerId)],
);

// 인자·응답 본문은 저장하지 않는다 (F-UI-03)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    endpointId: uuid().references(() => endpoints.id, { onDelete: 'set null' }),
    // 엔드포인트가 지워져도 어느 커넥터 호출이었는지 남긴다
    connectorId: uuid().references(() => connectors.id, { onDelete: 'set null' }),
    toolName: text().notNull(),
    result: callResult().notNull(),
    durationMs: integer().notNull(),
  },
  // 엔드포인트 상세의 최근 호출 20건
  (t) => [index().on(t.at), index().on(t.endpointId, t.at)],
);

// 사람이 한 작업 기록. 툴 호출은 audit_logs에 남긴다
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: activityAction().notNull(),
    targetType: activityTarget().notNull(),
    // oauth_client(공유 Client Secret)처럼 대상이 하나뿐이면 비운다
    targetId: uuid(),
    reason: text(),
  },
  (t) => [index().on(t.at), index().on(t.targetType, t.targetId)],
);
