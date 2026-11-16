import os
from pathlib import Path

import pytest

from mermantics.ontology import Ontology, OntologyError
from mermantics.robot import Robot, RobotError, find_java

FIXTURES = Path(__file__).parent / "fixtures"


def pytest_addoption(parser):
    parser.addoption(
        "--require-reasoner", action="store_true",
        help="Fail instead of skipping when Java or ROBOT is unavailable.",
    )


@pytest.fixture(scope="session")
def robot(request):
    """ROBOT runner; unavailable dependencies fail with --require-reasoner, else skip."""
    unavailable = pytest.fail if request.config.getoption("--require-reasoner") else pytest.skip
    if not find_java():
        unavailable("Java not found")
    try:
        return Robot()
    except RobotError as exc:
        unavailable(f"ROBOT not available: {exc}")


@pytest.fixture(scope="session")
def pmdco():
    """PMDco from $PMDCO_FILE, or downloaded once into the cache. Skips if unavailable."""
    source = os.environ.get("PMDCO_FILE", "pmdco:3.1.2")
    try:
        return Ontology.load([source])
    except OntologyError as exc:
        pytest.skip(f"PMDco not available: {exc}")


@pytest.fixture(scope="session")
def tiny():
    return Ontology.load([str(FIXTURES / "tiny.ttl")])
