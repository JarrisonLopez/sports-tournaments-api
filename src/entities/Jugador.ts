import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from "typeorm";

@Entity("jugadores")
export class Jugador {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 100 })
  nombre!: string;

  @Column({ type: "varchar", length: 20, unique: true })
  documento!: string;

  @Column({ type: "date" })
  fechaNacimiento!: Date;

  @Column({ type: "varchar", length: 50 })
  posicion!: string;
}