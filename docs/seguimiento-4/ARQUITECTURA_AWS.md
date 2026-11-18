# Arquitectura AWS — Sports API (Seguimiento #4)

## Decisión

**Kubernetes ligero con k3s sobre una sola EC2** (Amazon Linux 2023), no EKS.

| Criterio | k3s en EC2 | EKS |
|---|---|---|
| Costo académico | Bajo (1× t3.small/medium) | Alto (control plane + nodos) |
| Complejidad | Baja | Alta (IAM, add-ons, VPC) |
| Réplicas K8s | Sí (pods) | Sí |
| HA de nodo | No (1 nodo) | Posible |

EKS aporta HA de control plane y nodos, pero el coste y la superficie IAM no aportan valor al rubro académico. k3s cumple Deployment, Service, probes, requests/limits y dos réplicas.

## Topología

```text
Internet / compañeros
        │
   EC2 SG :80/:443/:6443 (restringido)
        │
   k3s (single node)
   ├── sports-tournaments-api ×2  (Deployment)
   ├── sports-mysql ×1            (Deployment + PVC)
   ├── Service NodePort/LoadBalancer (MetalLB opcional / NodePort + EIP)
   └── otel-collector ×1 (opcional local)
```

## Limitación documentada

Dos pods en **un único nodo** cumplen el requisito de réplicas, pero **no** aportan alta disponibilidad ante pérdida del nodo. Si el EC2 cae, ambos pods caen. Aceptable para laboratorio; no para producción.

## Componentes IaC

| Ruta | Rol |
|---|---|
| `infra/aws/terraform/` | VPC mínima, SG, EC2, EIP, user-data k3s |
| `k8s/aws/` | Manifiestos Sports + MySQL + ConfigMap/Secret |
| `k8s/local/` | Overlay para kind/k3d sin AWS |
| `infra/aws/scripts/` | bootstrap, deploy, verify, rollback |

## Puertos

La imagen de producción usa `PORT=8080`. Los manifiestos AWS alinean containerPort/probes a **8080**.

## Estado de despliegue

Lab AWS **desplegado** en `us-east-2` (perfil `sports-chaos`): k3s/EC2, namespace `sports-lab`, Sports NodePort `:30080` (`http://3.21.120.51:30080`). Usado para validación, Hotel 503 e intercloud; **restaurado** tras experimentos (`CHAOS_LAB_ENABLED=false`, Hotel OCI + Cine GCP). Detalle operativo: `AWS_DEPLOY.md` e `INFORME.md`.
