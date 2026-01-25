#!/bin/bash
./run.sh
cp output/*.json ../../hanzi-writer-data-youyin/data/

cd ../../YouyinWeb/
./run.sh
cd ../makemeahanzi/server/
