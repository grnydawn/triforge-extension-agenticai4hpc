#!/usr/bin/env bash

source ./triton_env.sh

CFG_FILE=${1:-./input/paraboloid/paraboloid.cfg}
MPI_CMD=${2:-mpirun -n 1}
${MPI_CMD} ./triton.exe ${CFG_FILE}

