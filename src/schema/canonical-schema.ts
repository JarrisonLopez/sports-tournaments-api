import { createHash } from "node:crypto";

/**
 * DDL de aplicación producido por TypeORM 1.1.0
 * (`schemaBuilder.log()`) contra MySQL 8.4.11 vacío y revisado a mano.
 *
 * No incluye charset ni collation: TypeORM tampoco los fija, así que cada
 * tabla hereda el default de la base, igual que `synchronize`.
 * No hay claves foráneas. El índice único de `jugadores.documento` usa el
 * nombre real emitido por el schema builder (`IDX_` + hash), no el prefijo `UQ_`.
 *
 * Estas sentencias no se ejecutan al arrancar la API.
 */
export const BOOTSTRAP_VERSION = "001-initial";

export const HISTORY_TABLE = "schema_bootstrap_history";

export const APPLICATION_TABLES = ["canchas", "jugadores", "torneos"] as const;

export const APPLICATION_DDL = [
  "CREATE TABLE `canchas` (`id` int NOT NULL AUTO_INCREMENT, `nombre` varchar(100) NOT NULL, `ubicacion` varchar(150) NOT NULL, `tipoSuperficie` varchar(50) NOT NULL, `disponible` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (`id`)) ENGINE=InnoDB",
  "CREATE TABLE `jugadores` (`id` int NOT NULL AUTO_INCREMENT, `nombre` varchar(100) NOT NULL, `documento` varchar(20) NOT NULL, `fechaNacimiento` date NOT NULL, `posicion` varchar(50) NOT NULL, UNIQUE INDEX `IDX_114aae6fc92b29624b3920b70e` (`documento`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
  "CREATE TABLE `torneos` (`id` int NOT NULL AUTO_INCREMENT, `nombre` varchar(100) NOT NULL, `deporte` varchar(50) NOT NULL, `fechaInicio` date NOT NULL, `fechaFin` date NOT NULL, `estado` varchar(20) NOT NULL DEFAULT 'PROGRAMADO', PRIMARY KEY (`id`)) ENGINE=InnoDB",
] as const;

export const HISTORY_DDL =
  "CREATE TABLE `schema_bootstrap_history` (`version` varchar(64) NOT NULL, `checksum` char(64) NOT NULL, `applied_at` datetime(6) NOT NULL, PRIMARY KEY (`version`)) ENGINE=InnoDB";

export const HISTORY_INSERT =
  "INSERT INTO `schema_bootstrap_history` (`version`, `checksum`, `applied_at`) VALUES (?, ?, UTC_TIMESTAMP(6))";

export const DOCUMENTO_UNIQUE_INDEX = "IDX_114aae6fc92b29624b3920b70e";

export function applicationChecksum(): string {
  return createHash("sha256").update(APPLICATION_DDL.join("\n"), "utf8").digest("hex");
}

export type ColumnExpectation = {
  name: string;
  columnType: string;
  nullable: boolean;
  defaultValue: string | null;
  extra: string;
  textual: boolean;
};

export type IndexExpectation = {
  name: string;
  unique: boolean;
  columns: string[];
};

export type TableExpectation = {
  name: string;
  columns: ColumnExpectation[];
  indexes: IndexExpectation[];
};

const idColumn: ColumnExpectation = {
  name: "id",
  columnType: "int",
  nullable: false,
  defaultValue: null,
  extra: "auto_increment",
  textual: false,
};

const primaryIndex: IndexExpectation = {
  name: "PRIMARY",
  unique: true,
  columns: ["id"],
};

export const EXPECTED_APP_TABLES: readonly TableExpectation[] = [
  {
    name: "canchas",
    columns: [
      idColumn,
      textColumn("nombre", "varchar(100)"),
      textColumn("ubicacion", "varchar(150)"),
      textColumn("tipoSuperficie", "varchar(50)"),
      {
        name: "disponible",
        columnType: "tinyint",
        nullable: false,
        defaultValue: "1",
        extra: "",
        textual: false,
      },
    ],
    indexes: [primaryIndex],
  },
  {
    name: "jugadores",
    columns: [
      idColumn,
      textColumn("nombre", "varchar(100)"),
      textColumn("documento", "varchar(20)"),
      {
        name: "fechaNacimiento",
        columnType: "date",
        nullable: false,
        defaultValue: null,
        extra: "",
        textual: false,
      },
      textColumn("posicion", "varchar(50)"),
    ],
    indexes: [
      {
        name: DOCUMENTO_UNIQUE_INDEX,
        unique: true,
        columns: ["documento"],
      },
      primaryIndex,
    ],
  },
  {
    name: "torneos",
    columns: [
      idColumn,
      textColumn("nombre", "varchar(100)"),
      textColumn("deporte", "varchar(50)"),
      {
        name: "fechaInicio",
        columnType: "date",
        nullable: false,
        defaultValue: null,
        extra: "",
        textual: false,
      },
      {
        name: "fechaFin",
        columnType: "date",
        nullable: false,
        defaultValue: null,
        extra: "",
        textual: false,
      },
      {
        name: "estado",
        columnType: "varchar(20)",
        nullable: false,
        defaultValue: "PROGRAMADO",
        extra: "",
        textual: true,
      },
    ],
    indexes: [primaryIndex],
  },
];

export const EXPECTED_HISTORY_TABLE: TableExpectation = {
  name: HISTORY_TABLE,
  columns: [
    textColumn("version", "varchar(64)"),
    textColumn("checksum", "char(64)"),
    {
      name: "applied_at",
      columnType: "datetime(6)",
      nullable: false,
      defaultValue: null,
      extra: "",
      textual: false,
    },
  ],
  indexes: [
    {
      name: "PRIMARY",
      unique: true,
      columns: ["version"],
    },
  ],
};

function textColumn(name: string, columnType: string): ColumnExpectation {
  return {
    name,
    columnType,
    nullable: false,
    defaultValue: null,
    extra: "",
    textual: true,
  };
}
