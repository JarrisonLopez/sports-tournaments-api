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
  fechaInicio!: string;

  @Column({ type: "date" })
  fechaFin!: string;

  @Column({ type: "varchar", length: 20, default: "PROGRAMADO" })
  estado!: string;
}