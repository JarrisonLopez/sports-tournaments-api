# Infra AWS — k3s sobre EC2

## Justificación

Se elige **k3s en una EC2 t3.small** frente a EKS para minimizar costo y complejidad académica, manteniendo Kubernetes real (Deployment ×2, Service, probes, resources).

## Uso (cuando haya credenciales autorizadas)

```bash
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# editar CIDR SSH y key_name
terraform init
terraform plan
# terraform apply   # SOLO con autorización explícita
```

Luego, en la instancia:

```bash
sudo cat /etc/rancher/k3s/k3s.yaml
# copiar kubeconfig y apuntar server a la EIP
./infra/aws/scripts/deploy.sh
./infra/aws/scripts/verify.sh
```

## Rollback

```bash
./infra/aws/scripts/rollback.sh
```

## Validación offline (sin AWS)

```bash
./infra/aws/scripts/validate-manifests.sh
```

## Estado

El apply a AWS **no** forma parte del commit de código. Hasta ejecutarlo con autorización, el despliegue remoto permanece no verificado.
