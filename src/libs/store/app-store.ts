import { exists } from "#libs/runtime";
import { symlink } from "node:fs/promises";
import path from "node:path";

/**
 * Representation of the App Store
 */
export class AppStore {
    /** Path of Hangar sata */
    readonly dataPath: string;

    /** Path where the app are installed */
    readonly installedPath: string;

    /** Path of the store */
    readonly storePath: string;

    constructor(dataDir: string) {
        this.dataPath = path.resolve(process.env.HANGAR_DATA_DIR);
        this.storePath = path.join(this.dataPath, "app-store");
        this.installedPath = path.join(this.dataPath, "app-installed");
    }

    async load() {

    }

    async isInstalled() {
        return exists(path.join(this.storePath, ".git"));
    }

    async linkAll() {

    }

    async link(name: string) {
        const source = path.join(this.storePath, name);
        const destination = path.join(this.installedPath, name);
        
        if ((await exists(source)) && !(await exists(destination))) {
            await symlink(path.join(this.storePath, name), path.join(this.installedPath, name), "dir");
        }
    }

    async install() {

    }

    async update() {

    }
}

const appStore = new AppStore(process.env.HANGAR_DATA_DIR);

export default appStore;