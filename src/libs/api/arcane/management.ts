import { config } from "#libs/store"
import { getProjects, updateProjectTag } from "./client.ts"

export const syncTags = async () => {
    const projects = await getProjects();

    if (!projects.success) {
        console.error("Failed to grab projects");
        return -1;
    }

    const stacks = config.categories.flatMap(c => c.stacks);

    for (const p of projects.data) {
        const isInHomelab = stacks.includes(p.dirName);

        if (isInHomelab) {
            // Adding category tag
            const category = config.categories.filter(c => c.stacks.includes(p.dirName)).at(0);
            
            try {
                await updateProjectTag(p.id, category!.name, category!.color, true);
            } catch (ex) {
                console.error("Failed to update tag", ex);
            }
        } else {
            if (p.runningCount > 0) {
                console.warn(`The project ${p.dirName} is running but not in any homelab category`);
            }
            
            // Removing category tag
            for (const tag of p.tags) {
                const isCatgoryTag = config.categories.filter(c => c.name === tag.name).length > 0;

                if (isCatgoryTag) {
                    try {
                        await updateProjectTag(p.id, tag.name, "", false);
                    } catch (ex) {
                        console.error("Failed to remove tag", ex);
                    }
                }
            }
        }
    }

    return 0;
}