#!/bin/bash
bsondump backup/meteor/glyphs.bson > tmp.json
./process.py
