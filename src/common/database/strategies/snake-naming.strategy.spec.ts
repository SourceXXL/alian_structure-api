import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { SnakeNamingStrategy } from "../strategies/snake-naming.strategy";

describe("SnakeNamingStrategy", () => {
  const strategy = new SnakeNamingStrategy();

  describe("tableName", () => {
    it("returns custom name when provided", () => {
      expect(strategy.tableName("User", "users")).toBe("users");
    });

    it("converts pascal case to snake case", () => {
      expect(strategy.tableName("UserProfile", undefined)).toBe(
        "user_profiles",
      );
    });

    it("handles single word names", () => {
      expect(strategy.tableName("User", undefined)).toBe("users");
    });
  });

  describe("columnName", () => {
    it("handles custom column names", () => {
      expect(strategy.columnName("createdAt", "created_at", [])).toBe(
        "created_at",
      );
    });

    it("handles embedded prefixes", () => {
      expect(strategy.columnName("name", undefined, ["address"])).toBe(
        "address_name",
      );
    });
  });

  describe("joinColumnName", () => {
    it("generates join column name", () => {
      expect(strategy.joinColumnName("user", "id")).toBe("user_id");
    });
  });

  describe("joinTableName", () => {
    it("generates join table name", () => {
      expect(strategy.joinTableName("User", "Role", "roles", "users")).toBe(
        "join__user_roles_users__role",
      );
    });
  });

  describe("primaryKeyName", () => {
    it("generates primary key name", () => {
      expect(strategy.primaryKeyName("users", ["id"])).toBe("users_id_pk");
    });
  });

  describe("indexName", () => {
    it("generates index name", () => {
      expect(strategy.indexName("users", ["email", "id"])).toBe(
        "users_email_id_idx",
      );
    });
  });
});
