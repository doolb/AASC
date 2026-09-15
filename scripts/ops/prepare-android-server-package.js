'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function copyServerSources(projectRoot, temporaryDir) {
    const sourceRoot = path.join(projectRoot, 'src');
    const targetRoot = path.join(temporaryDir, 'src');
    const excludedDirectory = path.resolve(sourceRoot, 'apps', 'android-display');
    await fs.promises.cp(sourceRoot, targetRoot, {
        recursive: true,
        filter: (sourcePath) => path.resolve(sourcePath) !== excludedDirectory &&
            !path.resolve(sourcePath).startsWith(`${excludedDirectory}${path.sep}`)
    });
    for (const fileName of ['package.json', 'package-lock.json']) {
        await fs.promises.copyFile(
            path.join(projectRoot, fileName),
            path.join(temporaryDir, fileName)
        );
    }
}

async function runNpmCi(temporaryDir, commandRunner) {
    const npmCommand = process.env.npm_execpath || 'npm';
    await commandRunner(npmCommand, ['ci', '--omit=dev', '--ignore-scripts'], {
        cwd: temporaryDir,
        env: process.env,
        stdio: 'inherit'
    });
}

function validatePreparedServerPackage(packageDir) {
    const requiredFiles = [
        'src/apps/server/boot/server-launcher.js',
        'package.json',
        'package-lock.json'
    ];
    for (const relativePath of requiredFiles) {
        const filePath = path.join(packageDir, relativePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            throw new Error(`生成服务器运行包缺少必需文件: ${relativePath}`);
        }
    }
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    if (!packageJson.dependencies || !packageJson.dependencies.express) {
        throw new Error('生成服务器运行包缺少 express 生产依赖声明');
    }
    if (!fs.existsSync(path.join(packageDir, 'node_modules', 'express'))) {
        throw new Error('生成服务器运行包缺少 express 生产依赖目录');
    }
}

async function prepareAndroidServerPackage(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'build', 'android-server-package'));
    const commandRunner = options.commandRunner || (async (file, args, commandOptions) => {
        await execFileAsync(file, args, commandOptions);
    });
    const temporaryDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
    const backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`;
    await fs.promises.rm(temporaryDir, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(outputDir), { recursive: true });

    try {
        await fs.promises.mkdir(temporaryDir, { recursive: true });
        await copyServerSources(projectRoot, temporaryDir);
        await runNpmCi(temporaryDir, commandRunner);
        validatePreparedServerPackage(temporaryDir);

        let oldPackageMoved = false;
        if (fs.existsSync(outputDir)) {
            await fs.promises.rm(backupDir, { recursive: true, force: true });
            await fs.promises.rename(outputDir, backupDir);
            oldPackageMoved = true;
        }
        try {
            await fs.promises.rename(temporaryDir, outputDir);
        } catch (error) {
            if (oldPackageMoved && fs.existsSync(backupDir)) {
                await fs.promises.rename(backupDir, outputDir);
            }
            throw error;
        }
        if (oldPackageMoved) await fs.promises.rm(backupDir, { recursive: true, force: true });
        return outputDir;
    } catch (error) {
        await fs.promises.rm(temporaryDir, { recursive: true, force: true });
        throw new Error(`准备 Android 服务器运行包失败: ${error.message}`);
    }
}

module.exports = {
    prepareAndroidServerPackage,
    validatePreparedServerPackage
};
