"""Extract only student surnames, given names and classes from the approved sheet.

The workbook is never modified. Real outputs belong in the ignored rosters/ folder.
Existing output IDs are reused by source row on repeat extraction of this workbook.
"""
import argparse
import hashlib
import json
from pathlib import Path
import posixpath
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SHEET = "To'lov umumiysi"


def extract(source):
    with zipfile.ZipFile(source) as book:
        strings = ["".join(t.text or "" for t in si.findall(".//m:t", NS))
                   for si in ET.fromstring(book.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        relationships = {r.attrib["Id"]: r.attrib["Target"] for r in
                         ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))}
        sheets = ET.fromstring(book.read("xl/workbook.xml")).find("m:sheets", NS)
        sheet = next(s for s in sheets if s.attrib["name"] == SHEET)
        target = relationships[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
        target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        students = []
        for row in ET.fromstring(book.read(target)).findall("m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                column = re.sub(r"\d", "", cell.attrib["r"])
                if column not in ("A", "C", "D"):
                    continue
                v = cell.find("m:v", NS)
                value = v.text if v is not None else ""
                if cell.attrib.get("t") == "s":
                    value = strings[int(value)] if value else ""
                elif cell.attrib.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in cell.findall(".//m:t", NS))
                values[column] = value
            if not (re.fullmatch(r"\d+", values.get("A", "")) and values.get("C")
                    and re.match(r"^\d", values.get("D", ""))):
                continue
            class_name = re.match(r"^(\d+)\s*([AB]?)", values["D"]).group(0).replace(" ", "")
            class_name = {"0": "0A", "11": "11A"}.get(class_name, class_name)
            raw = " ".join(values["C"].split())
            parts = raw.split()
            if len(parts) < 2:
                raise ValueError(f"Missing surname/given name at C{row.attrib['r']}")
            surname, given = parts[:2]
            # Three source cells join the father's name directly onto the given name.
            given = re.split(r"(?<=[a-z])[A-Z]", given, maxsplit=1)[0]
            aliases = []
            if surname.upper() == "BAXTIYOROV" and raw.upper().startswith("BAXTIYOROV BOBUR MIRZO "):
                given = "Boburmiroz"  # Spelling explicitly supplied by the owner.
                aliases = ["Bobur Mirzo", "Boburmirzo", "Bobur"]
            if surname.upper() == "ASATILLAYEV" and raw.upper().startswith("ASATILLAYEV MUXAMMAD AZIZ "):
                given = "Muhammadaziz"
                aliases = ["Muhammad Aziz", "Muxammad Aziz", "Muxammadaziz"]
            def display(value):
                # Preserve apostrophes inside Uzbek names, with consistent case.
                return value[:1].upper() + value[1:].lower()
            students.append({"className": class_name, "fullName": f"{display(surname)} {display(given)}",
                             "aliases": aliases, "sourceRow": int(row.attrib["r"])})
        return students


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", type=Path, default=Path("rosters/school-2026-2027.json"))
    parser.add_argument("--expected", type=int, default=381)
    args = parser.parse_args()
    students = extract(args.workbook)
    if len(students) != args.expected:
        raise ValueError(f"Expected {args.expected} students; found {len(students)}")
    prior = {}
    if args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        prior = {s["sourceRow"]: s for g in previous for s in g["students"] if "sourceRow" in s}
    groups = {}
    seen = set()
    for student in students:
        key = (student["className"], student["fullName"].casefold())
        if key in seen:
            raise ValueError(f"Duplicate surname and given name: {key}")
        seen.add(key)
        old = prior.get(student["sourceRow"])
        if old and (old["fullName"] != student["fullName"]):
            raise ValueError("Source row changed; review ID mapping manually before rebuilding")
        entry = {"id": old["id"] if old else "lsl-" + uuid.uuid4().hex,
                 "fullName": student["fullName"], "aliases": student["aliases"], "sourceRow": student["sourceRow"]}
        groups.setdefault(student["className"], []).append(entry)
    ordered = sorted(groups, key=lambda c: (int(re.match(r"\d+", c).group()), c))
    output = [{"className": name, "students": groups[name]} for name in ordered]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    review = ["LSL SCHOOL — o‘quvchilar ro‘yxati", f"Jami: {len(students)} o‘quvchi, {len(groups)} sinf", ""]
    for group in output:
        review.append(f"{group['className']} — {len(group['students'])} o‘quvchi")
        review.extend(f"{i}. {s['fullName']}" for i, s in enumerate(group["students"], 1))
        review.append("")
    args.output.with_suffix(".txt").write_text("\n".join(review), encoding="utf-8")
    provenance = {"sourceSheet": SHEET, "workbookSha256": hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
                  "students": len(students), "classes": {g["className"]: len(g["students"]) for g in output},
                  "note": "Owner approved 381-student source and given-name corrections. No patronymics imported."}
    args.output.with_suffix(".source.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(provenance, ensure_ascii=False))


if __name__ == "__main__":
    main()
