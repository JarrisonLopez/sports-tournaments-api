# Release Seguimiento #4

## Versión

**v4.1.0** — minor: caos, resiliencia, orquestación secuencial, infra AWS/k3s (sin romper contratos V2/V3/V4 existentes).

Tags previos relevantes: `v3.0.0`, `v3.0.1`. No se mueven tags antiguos.

## Preparación local (ya aplicada en la rama)

1. `package.json` → `4.1.0`
2. Tag anotado local: `v4.1.0`
3. Notas en `docs/seguimiento-4/RELEASE_NOTES.md`

## Publicar (SOLO con autorización explícita)

```powershell
git push -u origin feature/seguimiento-4-chaos-aws
git push origin v4.1.0
gh release create v4.1.0 --title "v4.1.0 Seguimiento 4 Chaos AWS" --notes-file docs/seguimiento-4/RELEASE_NOTES.md
```

No ejecutar push/release sin permiso.
