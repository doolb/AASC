#!/usr/bin/env python3
"""准备固定版本的原生依赖，仅写构建缓存，不修改上游源码。"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'build/third_party/mmd-ar-slam'
ORB_COMMIT = '4452a3c4ab75b1cde34e5505a36ec3f9edcdc4c4'
VOCABULARY_HASH = 'f8dd027f7a6cb88129821341194d7f2c75b77b3394257ddd0d2229863d1a3570'
ARCHIVE_HASHES = {
    'opencv-4.11.0-android-sdk.zip': 'fab645f6b42e4f02ed43e57191cab37b00b861d13191afa34d68fc9f3d8ff763',
    'boost_1_85_0.tar.bz2': '7009fe1faa1697476bdc7027703a2badb84e849b7b0baad5086b087b971f8617',
    'eigen-3.4.0.tar.gz': '8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72'
}


def run(*args):
    subprocess.run(args, check=True)


def download(name, url):
    archive = CACHE / name
    if not archive.exists():
        temporary = archive.with_suffix(archive.suffix + '.download')
        print(f'[native-slam] 下载 {name}', flush=True)
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(archive)
    return archive


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    orb = ROOT / 'build/third_party/orb-slam3'
    if not (orb / '.git').exists():
        run('git', 'clone', 'https://github.com/UZ-SLAMLab/ORB_SLAM3.git', str(orb))
        run('git', '-C', str(orb), 'checkout', '--detach', ORB_COMMIT)
    commit = subprocess.check_output(['git', '-C', str(orb), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != ORB_COMMIT:
        # 不切换已有的其他版本缓存，避免覆盖开发者改动。
        raise RuntimeError(f'ORB-SLAM3缓存版本应为{ORB_COMMIT}，实际{commit}')
    cv_archive = download('opencv-4.11.0-android-sdk.zip',
        'https://github.com/opencv/opencv/releases/download/4.11.0/opencv-4.11.0-android-sdk.zip')
    boost_archive = download('boost_1_85_0.tar.bz2',
        'https://archives.boost.io/release/1.85.0/source/boost_1_85_0.tar.bz2')
    eigen_archive = download('eigen-3.4.0.tar.gz',
        'https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz')
    # 在解压或参与编译前校验固定摘要，不能把初次下载内容当成权威锁。
    for archive_path in (cv_archive, boost_archive, eigen_archive):
        with archive_path.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != ARCHIVE_HASHES[archive_path.name]:
            raise RuntimeError(f'原生依赖SHA-256不匹配: {archive_path.name}')
    cv_marker = CACHE / 'OpenCV-android-sdk/.aasc-extracted'
    if not cv_marker.exists():
        with zipfile.ZipFile(cv_archive) as archive:
            for member in archive.infolist():
                if member.filename.startswith('OpenCV-android-sdk/sdk/native/') or member.filename.endswith('/LICENSE'):
                    archive.extract(member, CACHE)
        cv_marker.touch()
    with zipfile.ZipFile(cv_archive) as archive:
        for member in archive.infolist():
            if member.filename.startswith('OpenCV-android-sdk/sdk/etc/licenses/'):
                archive.extract(member, CACHE)
    for archive_path, directory in [(boost_archive, 'boost_1_85_0'), (eigen_archive, 'eigen-3.4.0')]:
        if (CACHE / directory / '.aasc-extracted').exists():
            continue
        with tarfile.open(archive_path) as archive:
            members = [m for m in archive.getmembers() if m.name.startswith(directory + '/')
                       and (directory != 'boost_1_85_0' or m.name.startswith((directory + '/boost/',
                            directory + '/libs/serialization/', directory + '/LICENSE')))]
            archive.extractall(CACHE, members=members, filter='data')
        (CACHE / directory / '.aasc-extracted').touch()
    assets = ROOT / '3rd/mmd-ar-test/app/build/generated/slam-assets/orb-slam3'
    assets.mkdir(parents=True, exist_ok=True)
    vocabulary = assets / 'ORBvoc.txt'
    vocabulary_valid = False
    if vocabulary.exists():
        with vocabulary.open('rb') as source:
            vocabulary_valid = hashlib.file_digest(source, 'sha256').hexdigest() == VOCABULARY_HASH
    if not vocabulary_valid:
        temporary = assets / 'ORBvoc.tmp'
        with tarfile.open(orb / 'Vocabulary/ORBvoc.txt.tar.gz') as archive:
            member = archive.getmember('ORBvoc.txt')
            with archive.extractfile(member) as source, temporary.open('wb') as output:
                shutil.copyfileobj(source, output)
        with temporary.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != VOCABULARY_HASH:
                raise RuntimeError('ORB词袋SHA-256不匹配')
        temporary.replace(vocabulary)
    shutil.copyfile(orb / 'LICENSE', assets / 'ORB-SLAM3-LICENSE.txt')
    shutil.copyfile(CACHE / 'boost_1_85_0/LICENSE_1_0.txt', assets / 'BOOST-LICENSE.txt')
    for source, name in [
        (orb / 'Thirdparty/g2o/license-bsd.txt', 'G2O-LICENSE.txt'),
        (orb / 'Thirdparty/Sophus/LICENSE.txt', 'SOPHUS-LICENSE.txt'),
        (CACHE / 'eigen-3.4.0/COPYING.MPL2', 'EIGEN-MPL2.txt'),
        (CACHE / 'eigen-3.4.0/COPYING.BSD', 'EIGEN-BSD.txt'),
        (CACHE / 'OpenCV-android-sdk/LICENSE', 'OPENCV-LICENSE.txt')]:
        shutil.copyfile(source, assets / name)
    # 补上README引用的原作者许可，同时保留该版本源文件中的作者通知。
    shutil.copytree(Path(__file__).resolve().parent / 'native-licenses', assets / 'dbow2-dutils', dirs_exist_ok=True)
    notices = []
    for name in ('DBoW2/FORB.h', 'DUtils/Random.h', 'DUtils/Timestamp.h'):
        source = (orb / 'Thirdparty/DBoW2' / name).read_text()
        notices.append(name + '\n' + source[:source.index('*/') + 2])
    (assets / 'DBOW2-NOTICES.txt').write_text('\n\n'.join(notices))
    mlp_notice = (orb / 'include/MLPnPsolver.h').read_text()
    (assets / 'MLPNP-NOTICES.txt').write_text(mlp_notice[:mlp_notice.index('*/') + 2])
    shutil.copytree(CACHE / 'OpenCV-android-sdk/sdk/etc/licenses', assets / 'opencv-third-party', dirs_exist_ok=True)
    (assets / 'VERSIONS.txt').write_text(
        f'ORB-SLAM3 https://github.com/UZ-SLAMLab/ORB_SLAM3 commit {ORB_COMMIT}\n'
        'OpenCV Android 4.11.0; Boost 1.85.0; Eigen 3.4.0\n'
        'Android headless/ownership/thread adaptations: app/src/main/cpp/CMakeLists.txt\n'
        'Sources and build recipe are part of AASC 3rd/mmd-ar-test.\n')
    (CACHE / 'archive-hashes.json').write_text(json.dumps(ARCHIVE_HASHES, indent=2) + '\n')
    print('[native-slam] 固定版本源码、依赖、词袋和许可证已准备', flush=True)


if __name__ == '__main__':
    main()
