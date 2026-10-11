"""Valideer een XML-bestand tegen een XSD met lxml, zonder netwerk.

Gebruik (draai Python met -I en zet de XSD in een eigen map buiten de repo):
    python -I test/xsd-valideer.py <schema.xsd> <bestand.xml>
Exitcode 0 = geldig, 1 = ongeldig (fouten op stdout), 2 = gebruik/laadfout.
"""
import sys

try:
    from lxml import etree
except ImportError:
    print("lxml ontbreekt: pip install lxml")
    sys.exit(2)

if len(sys.argv) != 3:
    print(__doc__)
    sys.exit(2)

parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
schema = etree.XMLSchema(etree.parse(sys.argv[1], parser))
doc = etree.parse(sys.argv[2], parser)
if schema.validate(doc):
    print("GELDIG", sys.argv[2])
    sys.exit(0)
for fout in schema.error_log:
    print(f"regel {fout.line}: {fout.message}")
sys.exit(1)
