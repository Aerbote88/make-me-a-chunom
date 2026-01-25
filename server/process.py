#!/usr/bin/env python3
import json, sys

def main():
    s = open("tmp.json", "r")
    json_raw = s.read().splitlines()
    s.close()
    for a in json_raw:
        data = json.loads(a)
        name = data["character"]
        strokes = []
        medians = []
        stages = data["stages"]

        if stages != None and stages["strokes"] != None:
            if stages["strokes"]["corrected"] != None:
                for stroke in stages["strokes"]["corrected"]:
                    strokes.append(stroke)
        else:
            print(name)

        if stages["order"] != None:
            for m in stages["order"]:
                obj = m["median"]
                lmedians = []
                for o in obj:
                    lm = []
                    for m1 in o:
                        lm.append(int(m1["$numberInt"]))
                    lmedians.append(lm)

                medians.append(lmedians)

        dt = {}
        dt["strokes"] = strokes
        dt["medians"] = medians

        f = open(f"output/{name}.json", "w")
        f.write(json.dumps(dt))
        f.close()


if __name__ == "__main__":
    main()
