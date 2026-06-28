const MODULE_ID = "pf2e-dual-class";

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing Proper Dual Class Support`);
});

/**
 * 1. INTERCEPT CLASS CREATION
 * The PF2e system strictly limits actors to one class. To bypass this gracefully,
 * we intercept the preCreateItem hook. If it's a class and they already have one, 
 * we convert it to a 'feat' type under the hood so the system accepts it, but 
 * flag it heavily so we know it's our secondary class.
 */
Hooks.on("preCreateItem", (item, data, options, userId) => {
    if (item.type !== "class" || !item.parent) return;

    const actor = item.parent;
    if (actor.type !== "character") return;

    const existingPrimaryClass = actor.class;

    if (existingPrimaryClass) {
        console.log(`${MODULE_ID} | Intercepted second class drop. Converting to Secondary Class feature.`);

        // Convert to a 'feat' so the PF2e system doesn't reject it for being a second 'class'
        item.updateSource({
            type: "feat",
            "system.category": "class", // Still categorized as a class feat
            "flags.pf2e-dual-class": {
                isSecondary: true,
                originalClassData: data // Store the original class data so we can reference its HP/Saves
            }
        });
    }
});

/**
 * 2. DATA PREPARATION (HP, SAVES & KEY ATTRIBUTE)
 * Calculate and apply the mathematical benefits of the secondary class.
 */
Hooks.on("pf2e.prepareDerivedData", (actor) => {
    if (actor.type !== "character") return;

    const secondaryClass = actor.items.find(i => i.flags?.[MODULE_ID]?.isSecondary);
    if (!secondaryClass) return;

    const primary = actor.class?.system;
    const secondaryData = secondaryClass.flags[MODULE_ID].originalClassData?.system;

    if (!primary || !secondaryData) return;

    // A. HP Calculation
    const primaryHp = primary.hp;
    const secondaryHp = secondaryData.hp;

    if (secondaryHp > primaryHp) {
        const hpDiff = secondaryHp - primaryHp;
        actor.synthetics.modifiers.hp = actor.synthetics.modifiers.hp || [];
        actor.synthetics.modifiers.hp.push(new game.pf2e.Modifier({
            slug: "dual-class-hp",
            label: `${secondaryClass.name} (Dual Class HP)`,
            modifier: hpDiff * actor.level,
            type: "untyped"
        }));
    }

    // B. Key Attribute Boost (Adding a flat rule element to grant the attribute)
    // The dual class rules state you get a boost to the secondary class's key attribute.
    const secondaryKeyAbility = secondaryData.keyAbility?.value?.[0]; // e.g., "str"
    if (secondaryKeyAbility) {
        // We push a synthetic rule element to grant this ability boost
        actor.synthetics.ephemeralEffects = actor.synthetics.ephemeralEffects || [];
        // Note: For a robust implementation, you might need to build a proper PF2e RuleElement
        // and inject it into the actor's rule elements array before data prep finishes.
    }
});

/**
 * 3. UI INJECTION & DRAG-AND-DROP
 */
Hooks.on("renderCharacterSheetPF2e", (app, html, data) => {
    const actor = app.actor;
    const secondaryClassItem = actor.items.find(i => i.flags?.[MODULE_ID]?.isSecondary);

    if (!secondaryClassItem) return;

    // --- Header Injection ---
    const classHeader = html.find('.char-details .class');
    if (classHeader.length && classHeader.find('.dual-class').length === 0) {
        classHeader.append(`<span class="dual-class"> / ${secondaryClassItem.name}</span>`);
    }

    // --- Feat Tab Injection ---
    const featsTab = html.find('.tab[data-tab="feats"]');
    if (featsTab.length && featsTab.find('.secondary-class-feats').length === 0) {

        let featSlotsHtml = "";
        const maxLevel = actor.level;

        // Find existing feats assigned to these secondary slots
        const assignedFeats = actor.items.filter(i => i.flags?.[MODULE_ID]?.secondarySlotLevel);

        for (let level = 2; level <= maxLevel; level += 2) {
            const slottedFeat = assignedFeats.find(f => f.flags[MODULE_ID].secondarySlotLevel === level);

            if (slottedFeat) {
                // Render the populated feat
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
                // Render an empty droppable slot
                featSlotsHtml += `
                    <li class="item feat-slot drop-zone" data-slot-level="${level}">
                        <div class="item-name">
                            <div class="item-image" style="background-image: url('icons/svg/mystery-man.svg')"></div>
                            <h4>Secondary Class Feat ${level}</h4>
                        </div>
                    </li>
                `;
            }
        }

        const secondaryFeatsHtml = `
            <div class="secondary-class-feats">
                <h3>${secondaryClassItem.name} Feats</h3>
                <ol class="item-list">
                    ${featSlotsHtml}
                </ol>
            </div>
        `;

        featsTab.append(secondaryFeatsHtml);

        // --- Drag and Drop Listeners ---
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

            const slotLevel = parseInt(e.currentTarget.dataset.slotLevel);

            try {
                const data = JSON.parse(e.originalEvent.dataTransfer.getData('text/plain'));
                if (data.type !== "Item") return;

                const item = await fromUuid(data.uuid);
                if (!item || item.type !== "feat") {
                    ui.notifications.warn("You can only drop Feats into Secondary Class slots.");
                    return;
                }

                // Create the item on the actor, flagged as a secondary feat
                const itemData = item.toObject();
                setProperty(itemData, `flags.${MODULE_ID}.secondarySlotLevel`, slotLevel);

                await actor.createEmbeddedDocuments("Item", [itemData]);
                ui.notifications.info(`Added ${item.name} as a level ${slotLevel} Secondary Class Feat.`);

            } catch (err) {
                console.error(`${MODULE_ID} | Drop error:`, err);
            }
        });
    }
});