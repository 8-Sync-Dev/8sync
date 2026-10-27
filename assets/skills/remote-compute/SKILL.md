---
name: remote-compute
description: Run research, replication, or benchmark code somewhere other than the bare host — a Docker sandbox, Modal serverless GPUs, or a persistent RunPod GPU pod. Use when the user picks an isolated/remote execution environment, or asks to run untrusted or GPU-heavy code safely.
allowed-tools: Bash(docker:*), Bash(modal:*), Bash(runpodctl:*)
---

# Remote Compute

Ported from `companion-inc/feynman`'s `docker`, `modal-compute`, and `runpod-compute` skills (MIT, Copyright (c) 2026 Companion, Inc.; notice in `deep-research/LICENSE-feynman.md`) (generic CLI usage — no feynman dependency). One skill, three backends: the agent stays on the host, the job runs elsewhere, raw outputs come back into the artifact folder.

## Pick a backend

| Need | Backend | Availability check |
| --- | --- | --- |
| Isolation, untrusted code, reproducible env, no GPU or a local GPU | **Docker** | `command -v docker` |
| Burst GPU, bounded job, no state between runs | **Modal** | `command -v modal` |
| Long run, persistent state, large datasets, SSH between iterations | **RunPod** | `command -v runpodctl` |

Never install packages, start training, or run an experiment before the user has confirmed the environment (`research-paper` and `autoresearch` ask this explicitly). Tie every remote resource to a named replication/benchmark objective — this skill is not for deploying services, unrelated batch jobs, or provider administration.

---

## Docker sandbox

Mount the project into a container, run the commands inside, results write back through the mount.

Python (most common):

```bash
docker run --rm -v "$(pwd)":/workspace -w /workspace python:3.11 bash -c "
  pip install -r requirements.txt &&
  python train.py
"
```

Project with a Dockerfile:

```bash
docker build -t research-experiment .
docker run --rm -v "$(pwd)/results":/workspace/results research-experiment
```

GPU workloads (requires the NVIDIA Container Toolkit):

```bash
docker run --rm --gpus all -v "$(pwd)":/workspace -w /workspace pytorch/pytorch:latest bash -c "
  pip install -r requirements.txt &&
  python train.py
"
```

### Choosing the base image

| Research type | Base image |
| --- | --- |
| Python ML/DL | `pytorch/pytorch:latest` or `tensorflow/tensorflow:latest-gpu` |
| Python general | `python:3.11` |
| Node.js | `node:20` |
| R / statistics | `rocker/r-ver:4` |
| Julia | `julia:1.10` |
| Multi-language | `ubuntu:24.04` with manual installs |

### Persistent containers

For an iterative loop (e.g. the `autoresearch` loop), use a named container instead of `--rm` so installed packages survive across iterations:

```bash
docker create --name <name> -v "$(pwd)":/workspace -w /workspace python:3.11 tail -f /dev/null
docker start <name>
docker exec <name> bash -c "pip install -r requirements.txt"
docker exec <name> bash -c "python train.py"
docker stop <name> && docker rm <name>   # clean up
```

Containers are network-enabled by default — add `--network none` for full isolation.

---

## Modal (serverless burst GPU)

No pod lifecycle to manage: write a decorated Python script, run it, save raw outputs back into the artifact folder.

```bash
pip install modal
modal setup
```

| Command | Description |
|---------|-------------|
| `modal run script.py` | Run one experiment script on Modal |
| `modal run --detach script.py` | Run a long experiment and record the returned app/run identifier |
| `modal shell --gpu a100` | Interactive GPU shell for environment debugging |

GPU types: `T4`, `L4`, `A10G`, `L40S`, `A100`, `A100-80GB`, `H100`, `H200`, `B200`. Multi-GPU: `"H100:4"`.

```python
import modal

app = modal.App("experiment")
image = modal.Image.debian_slim(python_version="3.11").pip_install("torch==2.8.0")

@app.function(gpu="A100", image=image, timeout=600)
def train():
    import torch
    # training code here

@app.local_entrypoint()
def main():
    train.remote()
```

---

## RunPod (persistent GPU pods)

```bash
brew install runpod/runpodctl/runpodctl   # macOS
# or: curl -sSL https://raw.githubusercontent.com/runpod/runpodctl/main/install.sh | bash
runpodctl config --apiKey=YOUR_KEY
```

| Command | Description |
|---------|-------------|
| `runpodctl create pod --gpuType "NVIDIA A100 80GB PCIe" --imageName "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04" --name experiment` | Create a pod |
| `runpodctl get pod` | List all pods |
| `runpodctl stop pod <id>` | Stop (preserves volume) |
| `runpodctl start pod <id>` | Resume a stopped pod |
| `runpodctl remove pod <id>` | Terminate and delete |
| `runpodctl gpu list` | List available GPU types and prices |
| `runpodctl send <file>` / `runpodctl receive <code>` | Transfer files to/from pods |

SSH access (pods must expose `22/tcp`; get details from `runpodctl get pod <id>`):

```bash
ssh root@<IP> -p <PORT> -i ~/.ssh/id_ed25519
```

GPU types: `NVIDIA GeForce RTX 4090`, `NVIDIA RTX A6000`, `NVIDIA A40`, `NVIDIA A100 80GB PCIe`, `NVIDIA H100 80GB HBM3`.

**Always stop or remove pods after the experiment** — they bill while running.
