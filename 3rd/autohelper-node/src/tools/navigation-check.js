import { readFile } from 'node:fs/promises';
import { compileNavigationGraph, resolveNavigationChain } from '../navigation/navigation-graph.js';
import { parseNavigationPackage } from '../navigation/package-parser.js';
import { validateNavigationPackage } from '../navigation/package-validator.js';

export const loadNavigationPackage = async (filePath) => {
    const contents = await readFile(filePath, 'utf8');
    return parseNavigationPackage(contents, filePath);
};

export const checkNavigationPackage = async (filePath) => {
    const navigationPackage = await loadNavigationPackage(filePath);
    const staticGraph = compileNavigationGraph(navigationPackage);
    return {
        packageId: navigationPackage.metadata.id,
        diagnostics: validateNavigationPackage(navigationPackage),
        staticGraph,
    };
};

export const resolveNavigationPackageChain = async (filePath, goalId, state = {}) => {
    const navigationPackage = await loadNavigationPackage(filePath);
    return resolveNavigationChain(
        compileNavigationGraph(navigationPackage),
        goalId,
        state,
    );
};
