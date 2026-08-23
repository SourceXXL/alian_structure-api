import { NamingStrategyInterface } from "typeorm";

export class SnakeNamingStrategy implements NamingStrategyInterface {
  name = "snake-case";

  tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName || this.pascalToSnake(targetName, true);
  }

  closureJunctionTableName(originalClosureTableName: string): string {
    return `${this.pascalToSnake(originalClosureTableName, true)}_closure`;
  }

  columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const prefix = embeddedPrefixes.length
      ? embeddedPrefixes.map((p) => this.pascalToSnake(p)).join("_") + "_"
      : "";
    return prefix + (customName || this.pascalToSnake(propertyName));
  }

  relationName(propertyName: string): string {
    return this.pascalToSnake(propertyName);
  }

  primaryKeyName(tableOrName: any, columnNames: string[]): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_${columnNames.join("_")}_pk`;
  }

  uniqueConstraintName(tableOrName: any, columnNames: string[]): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_${columnNames.join("_")}_unique`;
  }

  relationConstraintName(
    tableOrName: any,
    columnNames: string[],
    where?: string,
  ): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_${columnNames.join("_")}_rel`;
  }

  defaultConstraintName(tableOrName: any, columnName: string): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_${this.pascalToSnake(columnName)}_default`;
  }

  foreignKeyName(
    tableOrName: any,
    columnNames: string[],
    referencedTablePath?: string,
    referencedColumnNames?: string[],
  ): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    const ref = referencedTablePath
      ? this.pascalToSnake(referencedTablePath)
      : "unknown";
    return `${this.pascalToSnake(table)}_${columnNames.join("_")}_${ref}_fk`;
  }

  indexName(tableOrName: any, columns: string[], where?: string): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_${columns.join("_")}_idx`;
  }

  checkConstraintName(
    tableOrName: any,
    expression: string,
    isEnum?: boolean,
  ): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_check`;
  }

  exclusionConstraintName(tableOrName: any, expression: string): string {
    const table =
      typeof tableOrName === "string"
        ? tableOrName
        : (tableOrName?.name ?? "table");
    return `${this.pascalToSnake(table)}_exclude`;
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return (
      this.pascalToSnake(relationName) +
      "_" +
      this.pascalToSnake(referencedColumnName)
    );
  }

  joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
    secondPropertyName: string,
  ): string {
    return [
      this.pascalToSnake("join_" + firstTableName + "_" + firstPropertyName),
      this.pascalToSnake(secondPropertyName + "_" + secondTableName),
    ].join("_");
  }

  joinTableColumnDuplicationPrefix(columnName: string, index: number): string {
    return `${this.pascalToSnake(columnName)}${index}`;
  }

  joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return `${this.pascalToSnake(columnName || propertyName)}`;
  }

  joinTableInverseColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return `${this.pascalToSnake(columnName || propertyName)}`;
  }

  prefixTableName(prefix: string, tableName: string): string {
    return `${prefix}_${tableName}`;
  }

  nestedSetColumnNames = { left: "lft", right: "rgt" } as const;
  materializedPathColumnName = "materialized_path";

  private pascalToSnake(str: string, plural = false): string {
    let result = str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (result.startsWith("_")) result = result.slice(1);
    if (plural && result.endsWith("y")) {
      result = result.slice(0, -1) + "ies";
    } else if (plural && !result.match(/s$/)) {
      result += "s";
    }
    return result;
  }
}
