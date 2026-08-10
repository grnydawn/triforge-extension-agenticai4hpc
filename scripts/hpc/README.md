# triforge-hpc

Use a Triforge `.tfp` project on an HPC system (e.g. Frontier) where VS Code can't
run. Pure Python 3 standard library — no `pip install`, no `jq`, one file.

## Get it onto the cluster

```bash
scp scripts/hpc/triforge-hpc.py you@frontier:~/
```

## Use it

```bash
# 1. Unpack (lays out the project + a run-ready triton_execution.cfg + output/):
python3 triforge-hpc.py unpack MyFlood.tfp --dest myflood

# 2. Build TRITON inside the project dir, then run it. TRITON's build writes
#    triton_run.sh (which takes the cfg as arg 1 and the MPI launcher as arg 2,
#    default 'srun -n 8'):
cd myflood
#   ... build TRITON here (generates triton_run.sh + triton.exe) ...
./triton_run.sh ./triton_execution.cfg          # or: ./triton_run.sh ./triton_execution.cfg "srun -n 16"

# 3. Pack the outputs into a .tfp to import back into VS Code:
cd ..
python3 triforge-hpc.py pack myflood -o MyFlood.tfp
```

Back in VS Code: **Import Project… → Merge**, then animate the Output.

The cfg uses paths relative to the project directory, so **build and run TRITON from
inside the unpacked folder**. TRITON must be built/available on the cluster — the
archive carries your project, not the solver.
