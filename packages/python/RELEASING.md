# Releasing `tripwire-guard` to PyPI

## 1) One-time setup

- Create a PyPI project named `tripwire-guard` (or reserve it by first upload).
- Enable 2FA on your PyPI account.
- Create API tokens:
  - `pypi-...` token scoped to project `tripwire-guard` (production).
  - `pypi-...` token for TestPyPI project (optional, recommended).

## 2) Prepare a release

From this directory:

```bash
cd /Users/quirinschlegel/git/TripWire/packages/python
```

Update version in `pyproject.toml`:

```toml
[project]
version = "0.1.1"
```

Run verification:

```bash
PYTHONPATH=src /opt/miniconda3/bin/python -m pytest -q
/opt/miniconda3/bin/python -m pip install -U build twine packaging
/opt/miniconda3/bin/python -m build
/opt/miniconda3/bin/python -m twine check dist/*
```

## 3) Publish to TestPyPI (recommended)

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD='<TEST_PYPI_TOKEN>'
/opt/miniconda3/bin/python -m twine upload --repository-url https://test.pypi.org/legacy/ dist/*
```

Verify install from TestPyPI:

```bash
python3 -m venv /tmp/twire-test
source /tmp/twire-test/bin/activate
pip install -i https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple tripwire-guard
python -c "import twire_guard; print('ok', twire_guard.__all__[0])"
```

## 4) Publish to PyPI

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD='<PYPI_TOKEN>'
/opt/miniconda3/bin/python -m twine upload dist/*
```

## 5) Post-release checks

```bash
pip install -U tripwire-guard
python -c "from twire_guard import create_guard; print('tripwire-guard installed')"
twire --help
```

## 6) Optional: tag the release

```bash
git tag -a python-v0.1.1 -m "tripwire-guard v0.1.1"
git push origin python-v0.1.1
```
