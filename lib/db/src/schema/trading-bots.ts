import {
  bigint,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const botStatusEnum = pgEnum("bot_status", [
  "setup",
  "ready",
  "running",
  "paused",
  "stopped",
]);

export const botPhaseEnum = pgEnum("bot_phase", ["buying", "selling"]);

export const walletUsersTable = pgTable(
  "wallet_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address").notNull(),
    publicKey: text("public_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("wallet_users_address_unique").on(table.walletAddress)],
);

export const tradingBotsTable = pgTable(
  "trading_bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => walletUsersTable.id, { onDelete: "cascade" }),
    botAddress: text("bot_address").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    tokenId: text("token_id"),
    tokenSymbol: text("token_symbol"),
    activationTxId: text("activation_tx_id"),
    activationVerifiedAt: timestamp("activation_verified_at", { withTimezone: true }),
    configurationVersion: integer("configuration_version").notNull().default(1),
    status: botStatusEnum("status").notNull().default("setup"),
    phase: botPhaseEnum("phase").notNull().default("buying"),
    completedBuys: integer("completed_buys").notNull().default(0),
    completedSells: integer("completed_sells").notNull().default(0),
    totalTrades: integer("total_trades").notNull().default(0),
    lastTradeAt: timestamp("last_trade_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    inFlight: jsonb("in_flight"),
    stopReason: text("stop_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("trading_bots_user_unique").on(table.userId),
    uniqueIndex("trading_bots_address_unique").on(table.botAddress),
    uniqueIndex("trading_bots_activation_tx_unique").on(table.activationTxId),
  ],
);

export const activationPaymentsTable = pgTable(
  "activation_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => tradingBotsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => walletUsersTable.id, { onDelete: "cascade" }),
    configurationVersion: integer("configuration_version").notNull(),
    tokenId: text("token_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("activation_payments_transaction_unique").on(table.transactionId),
    uniqueIndex("activation_payments_configuration_unique").on(table.botId, table.configurationVersion),
  ],
);

export const kasWithdrawalsTable = pgTable(
  "kas_withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => tradingBotsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => walletUsersTable.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id").notNull(),
    destinationAddress: text("destination_address").notNull(),
    amountSompi: bigint("amount_sompi", { mode: "bigint" }).notNull(),
    feeSompi: bigint("fee_sompi", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("kas_withdrawals_transaction_unique").on(table.transactionId)],
);

export const managedLotsTable = pgTable(
  "managed_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => tradingBotsTable.id, { onDelete: "cascade" }),
    buyTransactionId: text("buy_transaction_id").notNull(),
    outputIndex: integer("output_index").notNull(),
    tokenAmount: bigint("token_amount", { mode: "bigint" }).notNull(),
    costSompi: bigint("cost_sompi", { mode: "bigint" }).notNull(),
    tokenId: text("token_id"),
    tokenSymbol: text("token_symbol"),
    sellTransactionId: text("sell_transaction_id"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("managed_lots_outpoint_unique").on(
      table.buyTransactionId,
      table.outputIndex,
    ),
  ],
);

export type WalletUser = typeof walletUsersTable.$inferSelect;
export type TradingBot = typeof tradingBotsTable.$inferSelect;
export type ManagedLot = typeof managedLotsTable.$inferSelect;