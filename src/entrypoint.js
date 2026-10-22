import { pathToFileURL } from 'node:url';

export function isEntryPoint(moduleUrl, argv = process.argv, env = process.env) {
    // PM2 imports ESM scripts from its loader; argv[1] can point to that loader.
    return [argv[1], env.pm_exec_path].filter(Boolean).some(file => pathToFileURL(file).href === moduleUrl);
}
