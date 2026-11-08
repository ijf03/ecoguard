"""Build Linux x86_64/Python 3.12 dependencies from pinned official PyPI wheels."""
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
root = pathlib.Path(__file__).resolve().parents[1]
output = root / '.build' / 'ecoguard-thumbnail.zip'
output.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='ecoguard-thumbnail-') as scratch:
    target = pathlib.Path(scratch)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--target', str(target), '--platform', 'manylinux_2_28_x86_64',
                    '--implementation', 'cp', '--python-version', '3.12', '--only-binary=:all:', '--ignore-installed',
                    '--disable-pip-version-check', '--no-cache-dir', '-r', str(root / 'workers/cloud-requirements.txt')], check=True)
    shutil.copyfile(root / 'workers/cloud_thumbnail.py', target / 'cloud_thumbnail.py')
    for cache in target.rglob('__pycache__'):
        shutil.rmtree(cache)
    size = sum(p.stat().st_size for p in target.rglob('*') if p.is_file())
    if size > 240 * 1024 * 1024:
        raise RuntimeError('Runtime exceeds the conservative Lambda ZIP extraction limit.')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(target.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(target))
    print(f'{output} ({size / 1024 / 1024:.1f} MiB extracted)')
