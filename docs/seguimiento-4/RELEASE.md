# Release Seguimiento #4

## Versión propuesta (cierre)

**v4.2.0** — minor: experimentos reales cerrados (Hotel OCI HTTP 503, integración Cine, latencia intercloud), OTLP/W3C, Chaos Gate endurecido, evidencias y informe final.

### Historial SemVer relevante

| Tag | Estado | Notas |
|---|---|---|
| `v3.0.0` / `v3.0.1` | Publicados en GitHub Releases | Entrega 3 GCP |
| `v4.1.0` | Tag **local** (no en `origin`) | Docs/caos iniciales |
| `v4.1.1` | Tag **local** + `package.json` histórico | Validación k6 / fallback / gate |
| **`v4.2.0`** | **Candidato de cierre** | No etiquetar ni publicar hasta autorización |

No se mueven ni republican `v4.1.0` / `v4.1.1`. HEAD aporta experimentos y docs posteriores a esos tags → corresponde **minor** `4.2.0`, no patch sobre 4.1.1.

## Preparación local (esta fase)

1. `package.json` / `package-lock.json` → `4.2.0`
2. Notas en `docs/seguimiento-4/RELEASE_NOTES.md`
3. Evidencias e informe actualizados en working tree
4. **Sin** `git tag` / `gh release` todavía

## Publicar (SOLO con autorización explícita, después de commit+push)

```powershell
git tag -a v4.2.0 -m "v4.2.0 Seguimiento 4 Chaos AWS — cierre evidencias"
git push origin v4.2.0
gh release create v4.2.0 --title "v4.2.0 Seguimiento 4 Chaos AWS" --notes-file docs/seguimiento-4/RELEASE_NOTES.md
```

No ejecutar tag/push/release sin permiso.
