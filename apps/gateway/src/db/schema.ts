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

// 명세의 도메인 모델 (User, Connector, Credential, Endpoint, AuditLog)

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const connectorRuntime = pgEnum('connector_runtime', ['remote', 'builtin', 'stdio']);
export const credentialScope = pgEnum('credential_scope', ['global', 'user']);
export const callResult = pgEnum('call_result', ['ok', 'error', 'denied']);

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
    ...timestamps,
  },
  (t) => [
    index().on(t.ownerId),
    check('personal_connector_runtime', sql`${t.ownerId} is null or ${t.runtime} <> 'stdio'`),
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
    enabled: boolean().notNull().default(true),
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
    toolName: text().notNull(),
    result: callResult().notNull(),
    durationMs: integer().notNull(),
  },
  (t) => [index().on(t.at)],
);
