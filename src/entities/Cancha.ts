import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from "typeorm";

@Entity("canchas")
export class Cancha {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 100 })
  nombre!: string;

  @Column({ type: "varchar", length: 150 })
  ubicacion!: string;

  @Column({ type: "varchar", length: 50 })
  tipoSuperficie!: string;

  @Column({ type: "boolean", default: true })
  disponible!: boolean;
}