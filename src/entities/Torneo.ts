import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from "typeorm";

@Entity("torneos")
export class Torneo {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 100 })
  nombre!: string;

  @Column({ type: "varchar", length: 50 })
  deporte!: string;

  @Column({ type: "date" })
  fechaInicio!: Date;

  @Column({ type: "date" })
  fechaFin!: Date;

  @Column({ type: "varchar", length: 20, default: "PROGRAMADO" })
  estado!: string;
}