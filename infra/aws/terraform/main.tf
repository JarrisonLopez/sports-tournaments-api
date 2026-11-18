data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  # Estándar AL2023 (excluye variantes ECS/neuron: al2023-ami-ecs-*).
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "k3s" {
  name        = "${var.project_name}-k3s"
  description = "Sports API k3s lab - SSH, API NodePort, k3s API"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_ingress_cidr]
  }

  ingress {
    description = "Sports API NodePort"
    from_port   = 30080
    to_port     = 30080
    protocol    = "tcp"
    cidr_blocks = [var.api_ingress_cidr]
  }

  ingress {
    description = "HTTP demo"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.api_ingress_cidr]
  }

  ingress {
    description = "k3s API (admin only; restringir en demo real)"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = [var.ssh_ingress_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-k3s"
  }
}

locals {
  user_data = <<-EOF
    #!/bin/bash
    set -euxo pipefail
    # AL2023 ya trae curl-minimal; no instalar paquete curl (conflicto).
    dnf install -y tar gzip container-selinux iptables || true
    curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644 --disable traefik
    mkdir -p /opt/sports/images /opt/sports/manifests
    ln -sfn /usr/local/bin/kubectl /usr/bin/kubectl || true
    echo "k3s ready $$(date -Is)" > /opt/sports/bootstrap.status
    systemctl is-active k3s
  EOF
}

resource "aws_instance" "k3s" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids      = [aws_security_group.k3s.id]
  associate_public_ip_address = true
  user_data                   = local.user_data
  key_name                    = var.key_name != "" ? var.key_name : null

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tags = {
    Name = "${var.project_name}-k3s"
  }

  lifecycle {
    precondition {
      condition     = var.key_name != ""
      error_message = "Definir key_name en terraform.tfvars (crear con infra/aws/scripts/create-keypair.ps1)."
    }
    precondition {
      condition     = var.ssh_ingress_cidr != "0.0.0.0/0"
      error_message = "Restringir ssh_ingress_cidr a tu IP/32 (no 0.0.0.0/0)."
    }
  }
}

resource "aws_eip" "k3s" {
  count  = var.create_elastic_ip ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-k3s-eip"
  }
}

resource "aws_eip_association" "k3s" {
  count         = var.create_elastic_ip ? 1 : 0
  instance_id   = aws_instance.k3s.id
  allocation_id = aws_eip.k3s[0].id
}
