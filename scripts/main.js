const MODULE_ID = "pf2e-dual-class";

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing Proper Dual Class Support`);
});

// Module settings
Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "autoAssignSecondaryFeats", {
        name: "pf2e-dual-class.settings.autoAssign.name",
        hint: "pf2e-dual-class.settings.autoAssign.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
});

function isSecondaryClassItem(item) {
    return !!item?.flags?.[MODULE_ID]?.isSecondaryClass;
}

function getSecondaryClassItem(actor) {
    return actor.items.find((i) => isSecondaryClassItem(i));
}

function getSecondaryClassSystemData(secondaryClassItem) {
    return secondaryClassItem?.flags?.[MODULE_ID]?.originalClassData?.system ?? {};
}

function getSecondaryClassSlug(secondaryClassItem) {
    return secondaryClassItem?.flags?.[MODULE_ID]?.secondaryClassSlug
        ?? secondaryClassItem?.system?.slug
        ?? secondaryClassItem?.slug
        ?? secondaryClassItem?.name?.toLowerCase()?.replace(/[^a-z0-9]+/g, "-");
}

function getSecondaryClassName(secondaryClassItem) {
    return secondaryClassItem?.flags?.[MODULE_ID]?.secondaryClassName
        ?? secondaryClassItem?.name
        ?? "Secondary Class";
}

function getSecondaryClassKeyAbility(secondaryClassData) {
    const keyAbility = secondaryClassData?.keyAbility;
    if (!keyAbility) return null;
    if (Array.isArray(keyAbility.value)) return keyAbility.value[0];
    return keyAbility.value ?? null;
}

function getSecondaryClassSaves(secondaryClassData) {
    const saves = secondaryClassData?.savingThrows ?? secondaryClassData?.saves ?? {};
    return ["fortitude", "reflex", "will"].filter((saveType) => !!saves[saveType]);
}

function hasClassSave(classData, saveType) {
    const savingThrows = classData?.savingThrows ?? classData?.saves ?? {};
    const saveEntry = savingThrows[saveType];
    return !!(saveEntry?.value ?? saveEntry);
}

function capitalizeString(string) {
    return typeof string === "string" && string.length ? string[0].toUpperCase() + string.slice(1) : string;
}

function createModifier(data) {
    if (game?.pf2e?.Modifier) {
        return new game.pf2e.Modifier(data);
    }
    return data;
}

function proficiencyFlatForRank(rank) {
    return 2 * (Number(rank) || 0);
}

function parseProficiencyRank(rank) {
    if (rank == null) return 1;
    if (typeof rank === "number") return Math.max(0, Math.min(4, Math.floor(rank)));
    const r = String(rank).toLowerCase();
    if (r === "untrained" || r === "0" || r === "none") return 0;
    if (r === "trained" || r === "1") return 1;
    if (r === "expert" || r === "2") return 2;
    if (r === "master" || r === "3") return 3;
    if (r === "legendary" || r === "4") return 4;
    const n = Number(rank);
    if (!Number.isNaN(n)) return Math.max(0, Math.min(4, Math.floor(n)));
    return 1;
}

function getSecondaryClassRules(secondaryClassItem, secondaryClassData) {
    return secondaryClassItem?.system?.rules ?? secondaryClassData?.rules ?? [];
}

function getClassProficiencyEntries(classData) {
    const entries = [];
    const profRoot = classData?.proficiencies ?? classData?.proficiency ?? classData?.proficienciesByCategory ?? null;
    if (profRoot && typeof profRoot === "object") {
        for (const [key, val] of Object.entries(profRoot)) {
            if (Array.isArray(val)) {
                val.forEach((v) => {
                    // try to extract a rank if present
                    const rank = Number(v?.rank ?? v?.value ?? 1);
                    entries.push({ selector: key, rank });
                });
            } else if (typeof val === "object") {
                const rank = Number(val?.rank ?? val?.value ?? 1);
                entries.push({ selector: key, rank });
            } else {
                entries.push({ selector: key, rank: Number(val) || 1 });
            }
        }
    }

    // Common schema fallbacks
    ["weapons", "armor", "skills", "perception"].forEach((k) => {
        if (classData?.[k]) {
            const v = classData[k];
            const rank = Number(v?.rank ?? v?.value ?? 1);
            entries.push({ selector: k, rank });
        }
    });

    return entries;
}

function getSelectorRank(classData, selector) {
    if (!classData) return 0;

    // Check saving throws
    const savingThrows = classData?.savingThrows ?? classData?.saves ?? {};
    const saveEntry = savingThrows[selector];
    if (saveEntry !== undefined) {
        if (typeof saveEntry === "object") return parseProficiencyRank(saveEntry?.rank ?? saveEntry?.value ?? saveEntry);
        if (typeof saveEntry === "boolean") return saveEntry ? 1 : 0;
        return parseProficiencyRank(saveEntry);
    }

    // Check proficiencies root
    const profRoot = classData?.proficiencies ?? classData?.proficiency ?? classData?.proficienciesByCategory ?? null;
    if (profRoot && typeof profRoot === "object") {
        const val = profRoot[selector];
        if (val !== undefined) {
            if (Array.isArray(val)) return Math.max(...val.map((v) => parseProficiencyRank(v?.rank ?? v?.value ?? v)));
            if (typeof val === "object") return parseProficiencyRank(val?.rank ?? val?.value ?? val);
            return parseProficiencyRank(val);
        }
    }

    // Direct property fallback (weapons/armor/skills/perception)
    const direct = classData?.[selector];
    if (direct !== undefined) {
        if (Array.isArray(direct)) return Math.max(...direct.map((v) => parseProficiencyRank(v?.rank ?? v?.value ?? v)));
        if (typeof direct === "object") return parseProficiencyRank(direct?.rank ?? direct?.value ?? direct);
        return parseProficiencyRank(direct);
    }

    return 0;
}

function buildSecondaryClassRuleElements(classData, className, primaryClassData = {}) {
    const rules = [];
    const keyAbility = getSecondaryClassKeyAbility(classData);
    if (keyAbility) {
        rules.push({
            key: "FlatModifier",
            selector: keyAbility,
            type: "untyped",
            value: 1,
            label: `${className} secondary class key ability bonus`,
            slug: `${className?.toLowerCase()?.replace(/[^a-z0-9]+/g, "-")}-secondary-key-ability`
        });
    }

    getSecondaryClassSaves(classData).forEach((saveType) => {
        const primaryRank = getSelectorRank(primaryClassData, saveType);
        const secondaryRank = Math.max(getSelectorRank(classData, saveType), parseProficiencyRank(1));
        const desiredRank = Math.max(primaryRank, secondaryRank);
        if (desiredRank > primaryRank) {
            rules.push({
                key: "GrantProficiency",
                selector: saveType,
                rank: desiredRank,
                label: `${className} secondary class ${saveType} save proficiency`,
                slug: `${className?.toLowerCase()?.replace(/[^a-z0-9]+/g, "-")}-secondary-${saveType}-save`
            });
        }
    });

    // Add proficiencies (weapons/armor/skills) from class data when present
    const profEntries = getClassProficiencyEntries(classData);
    profEntries.forEach((entry) => {
        // Avoid duplicating save proficiencies
        if (["fortitude", "reflex", "will"].includes(entry.selector)) return;
        const secondaryRank = parseProficiencyRank(entry.rank ?? 1);
        const primaryRank = getSelectorRank(primaryClassData, entry.selector);
        const desiredRank = Math.max(primaryRank, secondaryRank);
        if (desiredRank > primaryRank) {
            rules.push({
                key: "GrantProficiency",
                selector: entry.selector,
                rank: desiredRank,
                label: `${className} secondary class ${entry.selector} proficiency`,
                slug: `${className?.toLowerCase()?.replace(/[^a-z0-9]+/g, "-")}-secondary-${entry.selector}-prof`
            });
        }
    });

    return rules;
}

function ensureSynthetics(actor) {
    actor.synthetics = actor.synthetics || {};
    actor.synthetics.modifiers = actor.synthetics.modifiers || {};
    actor.synthetics.modifiers.hp = actor.synthetics.modifiers.hp || [];
    actor.synthetics.modifiers.ability = actor.synthetics.modifiers.ability || [];
    actor.synthetics.modifiers.savingThrow = actor.synthetics.modifiers.savingThrow || [];
}

function getFeatLevel(item) {
    return Number(item?.system?.level?.value ?? item?.system?.level ?? item?.level ?? 0);
}

function isClassFeatForSecondary(item, secondaryClassSlug) {
    if (item.type !== "feat") return false;
    if (item.system?.category !== "class") return false;
    if (!secondaryClassSlug) return true;

    const slug = item.system?.slug ?? item.slug ?? item.name?.toLowerCase()?.replace(/[^a-z0-9]+/g, "-");
    if (slug?.includes(secondaryClassSlug)) return true;

    const traits = item.system?.traits?.value ?? [];
    return traits.includes(secondaryClassSlug);
}

function isValidSecondaryClassFeatForSlot(item, secondaryClassSlug, slotLevel) {
    if (!isClassFeatForSecondary(item, secondaryClassSlug)) return false;
    return getFeatLevel(item) === Number(slotLevel);
}

function isSecondaryClassFeat(item) {
    return item.type === "feat" && Number.isFinite(Number(item?.flags?.[MODULE_ID]?.secondarySlotLevel));
}

function autoAssignSecondaryClassFeats(actor, secondaryClassSlug, secondaryClassName, featLevels) {
    const existingFeats = actor.items.filter((item) => !isSecondaryClassFeat(item) && isClassFeatForSecondary(item, secondaryClassSlug));
    const updated = [];

    featLevels.forEach((level) => {
        const slotHasFeat = actor.items.some((item) => Number(item?.flags?.[MODULE_ID]?.secondarySlotLevel) === level);
        if (slotHasFeat) return;

        const match = existingFeats.find((item) => getFeatLevel(item) === level && !item?.flags?.[MODULE_ID]?.secondarySlotLevel);
        if (!match) return;

        const data = duplicate(match.toObject());
        setProperty(data, `flags.${MODULE_ID}.secondarySlotLevel`, level);
        setProperty(data, `flags.${MODULE_ID}.secondaryClassSlug`, secondaryClassSlug);
        setProperty(data, `flags.${MODULE_ID}.secondaryClassName`, secondaryClassName);
        updated.push(data);
    });

    if (updated.length) {
        return actor.createEmbeddedDocuments("Item", updated);
    }
    return Promise.resolve([]);
}

function buildSecondaryFeatLevels(actorLevel) {
    const maxLevel = Math.min(Math.max(Number(actorLevel ?? 1), 1), 20);
    const levels = [];
    for (let level = 2; level <= maxLevel; level += 2) {
        levels.push(level);
    }
    return levels;
}

async function runPopulateSecondaryFeats(actor, secondaryClassItem) {
    if (!actor || !secondaryClassItem) {
        ui.notifications.warn(`${MODULE_ID}: No actor or secondary class available to populate.`);
        return;
    }

    const secondaryClassSlug = getSecondaryClassSlug(secondaryClassItem);
    const secondaryClassName = getSecondaryClassName(secondaryClassItem);
    const featLevels = buildSecondaryFeatLevels(actor.level);

    // Use the helper to auto-assign existing class feats into secondary slots
    const result = await autoAssignSecondaryClassFeats(actor, secondaryClassSlug, secondaryClassName, featLevels);
    if (result && result.length) {
        ui.notifications.info(`${MODULE_ID}: Populated ${result.length} secondary-class feats.`);
    } else {
        ui.notifications.info(`${MODULE_ID}: No matching class feats found to populate.`);
    }
}

function applySecondaryClassModifiers(actor, secondaryClassItem, secondaryClassData) {
    const primaryClassData = actor.class?.system;
    if (!primaryClassData || !secondaryClassData) return;

    ensureSynthetics(actor);

    const primaryHp = Number(primaryClassData.hp ?? primaryClassData.hitPoints ?? 0);
    const secondaryHp = Number(secondaryClassData.hp ?? secondaryClassData.hitPoints ?? 0);
    const hpBonus = Math.max(0, secondaryHp - primaryHp);
    if (hpBonus > 0) {
        actor.synthetics.modifiers.hp.push(createModifier({
            slug: "dual-class-hp",
            label: `${secondaryClassItem.name} (Dual Class HP bonus)`,
            modifier: hpBonus * actor.level,
            type: "untyped",
            enabled: true
        }));
    }

    const secondaryKeyAbility = getSecondaryClassKeyAbility(secondaryClassData);
    if (secondaryKeyAbility) {
        actor.synthetics.modifiers.ability.push(createModifier({
            slug: "dual-class-key-ability",
            label: `${secondaryClassItem.name} (Dual Class Key Ability)`,
            modifier: 1,
            type: "untyped",
            ability: secondaryKeyAbility,
            selector: secondaryKeyAbility,
            enabled: true
        }));
    }

    // GrantProficiency rule elements are emitted on the secondary-class feat
    // (see `system.rules`) and should be processed by the PF2e rule engine.
    // We avoid duplicating their effects here to let the system apply true
    // proficiency ranks and scaling. If a fallback is desired for compatibility,
    // we could synthesize modifiers here only when the system doesn't apply them.
}

Hooks.on("preCreateItem", (item, data, options, userId) => {
    if (item.type !== "class" || !item.parent) return;

    const actor = item.parent;
    if (actor.type !== "character") return;

    const existingPrimaryClass = actor.class;
    if (!existingPrimaryClass) return;

    console.log(`${MODULE_ID} | Intercepted second class drop. Converting to a secondary class feature.`);

    const originalClassData = duplicate(data ?? item.toObject());
    const className = originalClassData?.name;
    const rules = buildSecondaryClassRuleElements(originalClassData?.system ?? {}, className, existingPrimaryClass?.system ?? {});

    item.updateSource({
        type: "feat",
        "system.category": "class",
        "system.featType": "class",
        "system.rules": rules,
        flags: {
            [MODULE_ID]: {
                isSecondaryClass: true,
                originalClassData,
                secondaryClassSlug: originalClassData?.system?.slug,
                secondaryClassName: className
            }
        }
    });
});

Hooks.on("pf2e.prepareDerivedData", (actor) => {
    if (actor.type !== "character") return;

    const secondaryClassItem = getSecondaryClassItem(actor);
    if (!secondaryClassItem) return;

    const secondaryClassData = getSecondaryClassSystemData(secondaryClassItem);
    if (!secondaryClassData) return;

    applySecondaryClassModifiers(actor, secondaryClassItem, secondaryClassData);
});

Hooks.on("renderCharacterSheetPF2e", (app, html) => {
    const actor = app.actor;
    const secondaryClassItem = getSecondaryClassItem(actor);
    if (!secondaryClassItem) return;

    const secondaryClassData = getSecondaryClassSystemData(secondaryClassItem);
    const secondaryName = getSecondaryClassName(secondaryClassItem);
    const secondaryKeyAbility = getSecondaryClassKeyAbility(secondaryClassData);
    const secondarySaves = getSecondaryClassSaves(secondaryClassData);

    const classHeader = html.find(".char-details .class");
    if (classHeader.length && classHeader.find(".dual-class").length === 0) {
        classHeader.append(`<span class="dual-class"> / ${secondaryName}</span>`);
    }

    const featsTab = html.find('.tab[data-tab="feats"]');
    if (!featsTab.length) return;
    if (featsTab.find('.secondary-class-feats').length) return;

    const featLevels = buildSecondaryFeatLevels(actor.level);
    let featSlotsHtml = "";
    const assignedFeats = actor.items.filter((i) => isSecondaryClassFeat(i));

    featLevels.forEach((level) => {
        const slottedFeat = assignedFeats.find((f) => Number(f.flags[MODULE_ID]?.secondarySlotLevel) === level);
        if (slottedFeat) {
            featSlotsHtml += `
                <li class="item" data-item-id="${slottedFeat.id}">
                    <div class="item-name">
                        <div class="item-image" style="background-image: url('${slottedFeat.img}')"></div>
                        <h4>${slottedFeat.name}</h4>
                    </div>
                    <div class="item-controls">
                        <a class="item-control item-edit" title="Edit Item"><i class="fas fa-edit"></i></a>
                        <a class="item-control item-delete" title="Delete Item"><i class="fas fa-trash"></i></a>
                    </div>
                </li>
            `;
        } else {
            featSlotsHtml += `
                <li class="item feat-slot drop-zone" data-slot-level="${level}">
                    <div class="item-name">
                        <div class="item-image" style="background-image: url('icons/svg/mystery-man.svg')"></div>
                        <h4>Secondary Class Feat ${level}</h4>
                    </div>
                </li>
            `;
        }
    });

    const secondarySummaryHtml = `
        <div class="secondary-class-summary">
            <h3>${secondaryName} Summary</h3>
            <p>Key Ability: ${secondaryKeyAbility ? secondaryKeyAbility.toUpperCase() : "Unknown"}</p>
            <p>Saves: ${secondarySaves.length ? secondarySaves.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ") : "None"}</p>
            <p>
                <button class="refresh-secondary-class btn">Refresh Secondary Class</button>
                <button class="populate-secondary-feats btn">Populate Secondary Feats</button>
            </p>
        </div>
    `;

    const secondaryFeatsHtml = `
        <div class="secondary-class-feats">
            <h3>${secondaryName} Feats</h3>
            <p class="secondary-class-help">Drop class feats here to assign them as secondary-class selections.</p>
            <ol class="item-list">
                ${featSlotsHtml}
            </ol>
        </div>
    `;

    featsTab.append(secondarySummaryHtml + secondaryFeatsHtml);

    const dropZones = html.find('.secondary-class-feats .drop-zone');
    dropZones.on('dragenter', (e) => {
        e.preventDefault();
        $(e.currentTarget).addClass('drag-hover');
    });
    dropZones.on('dragleave', (e) => {
        e.preventDefault();
        $(e.currentTarget).removeClass('drag-hover');
    });
    dropZones.on('drop', async (e) => {
        e.preventDefault();
        $(e.currentTarget).removeClass('drag-hover');

        const slotLevel = Number(e.currentTarget.dataset.slotLevel);
        try {
            const data = JSON.parse(e.originalEvent.dataTransfer.getData('text/plain'));
            if (data.type !== "Item") return;

            const droppedItem = await fromUuid(data.uuid);
            if (!droppedItem || droppedItem.type !== "feat" || droppedItem.system.category !== "class") {
                ui.notifications.warn("Drop a class feat into a secondary class slot.");
                return;
            }

            const secondaryClassSlug = getSecondaryClassSlug(secondaryClassItem);
            if (!isValidSecondaryClassFeatForSlot(droppedItem, secondaryClassSlug, slotLevel)) {
                ui.notifications.warn("This feat must match the secondary class and the slot level.");
                return;
            }

            const itemData = droppedItem.toObject();
            setProperty(itemData, `flags.${MODULE_ID}.secondarySlotLevel`, slotLevel);
            setProperty(itemData, `flags.${MODULE_ID}.secondaryClassSlug`, secondaryClassSlug);
            setProperty(itemData, `flags.${MODULE_ID}.secondaryClassName`, secondaryName);
            await actor.createEmbeddedDocuments("Item", [itemData]);
            ui.notifications.info(`Added ${droppedItem.name} as a level ${slotLevel} Secondary Class Feat.`);
        } catch (err) {
            console.error(`${MODULE_ID} | Drop error:`, err);
        }
    });

    // Refresh / re-run secondary-class derived data
    html.find('.refresh-secondary-class').on('click', async (ev) => {
        try {
            ui.notifications.info(`${MODULE_ID}: Re-applying secondary-class effects...`);
            // Re-run actor preparation which will fire pf2e.prepareDerivedData
            // and cause `applySecondaryClassModifiers` to execute.
            await actor.prepareData();
            app.render(true);
            ui.notifications.info(`${MODULE_ID}: Secondary-class refresh complete.`);
        } catch (err) {
            console.error(`${MODULE_ID} | Refresh error:`, err);
            ui.notifications.error(`${MODULE_ID}: Failed to refresh secondary class.`);
        }
    });

    // Manual populate secondary feats control
    html.find('.populate-secondary-feats').on('click', async (ev) => {
        try {
            await runPopulateSecondaryFeats(actor, secondaryClassItem);
        } catch (err) {
            console.error(`${MODULE_ID} | Populate error:`, err);
            ui.notifications.error(`${MODULE_ID}: Failed to populate secondary feats.`);
        }
    });
});

// Auto-assign secondary-class feats on level change when enabled
Hooks.on("updateActor", async (actor, diff, options, userId) => {
    try {
        if (!actor || actor.type !== "character") return;
        const enabled = game.settings.get(MODULE_ID, "autoAssignSecondaryFeats");
        if (!enabled) return;

        // Detect level change in diff (support common shapes)
        const levelChanged = !!(
            diff?.system?.details?.level?.value !== undefined ||
            diff?.level !== undefined ||
            diff?.data?.level !== undefined
        );
        if (!levelChanged) return;

        const secondaryClassItem = getSecondaryClassItem(actor);
        if (!secondaryClassItem) return;

        const secondaryClassSlug = getSecondaryClassSlug(secondaryClassItem);
        const secondaryClassName = getSecondaryClassName(secondaryClassItem);
        const featLevels = buildSecondaryFeatLevels(actor.level);

        await autoAssignSecondaryClassFeats(actor, secondaryClassSlug, secondaryClassName, featLevels);
    } catch (err) {
        console.error(`${MODULE_ID} | updateActor handler error:`, err);
    }
});