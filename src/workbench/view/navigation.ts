import type { AnchorSource, ReaderSectionHeading } from "../../core/index.ts";
import { renderTocTree, type CurriculumItem } from "../../plugins/stage-reader/pagination.ts";
import { pithIcon } from "../icons.ts";

export interface NavigationLesson { readonly name: string; readonly basedOn?: readonly string[]; readonly outdated?: boolean }
export interface NavigationMaterial {
  readonly id: string; readonly title: string; readonly kind?: string; readonly files: readonly { readonly name: string }[];
  readonly externalPath?: string; readonly commitSha?: string; readonly createdAt?: string;
  readonly basedLessons?: readonly string[]; readonly newerVersion?: { readonly id: string; readonly commitSha: string };
}

export function renderNavigation(navigation: HTMLElement, document: { files: readonly NavigationLesson[]; curriculum?: readonly CurriculumItem[]; sections: readonly ReaderSectionHeading[]; currentFile: string; source?: AnchorSource; materialGroups?: readonly NavigationMaterial[] }, navigate: (locator: string) => void): void {
  const doc = navigation.ownerDocument; navigation.replaceChildren();
  const group = (label: string): void => { const heading = doc.createElement("h2"); heading.textContent = label; navigation.append(heading); };
  const fileButton = (name: string): void => { const button = doc.createElement("button"); button.textContent = name; button.dataset.file = name; button.setAttribute("aria-current", String(name === document.currentFile)); navigation.append(button); };
  if (document.materialGroups) {
    if (document.files.length || document.curriculum?.length) group("讲义");
    const staleBadge = (button: HTMLElement, name: string) => { if (document.files.find(file => file.name === name)?.outdated) { const badge = doc.createElement("span"); badge.className = "pith-lesson-badge"; badge.textContent = "基于旧版本"; button.append(badge); } };
    const planned = document.curriculum ?? [];
    for (const item of planned) {
      const button = doc.createElement("button"), title = doc.createElement("span"); button.className = "pith-lesson"; title.className = "pith-lesson-title"; title.textContent = item.title; button.append(title);
      if (item.status === "ready") { button.dataset.file = item.fileName; button.dataset.lesson = ""; button.setAttribute("aria-current", String(document.source?.kind === "lesson" && item.fileName === document.currentFile)); }
      else { button.dataset.plannedLesson = item.fileName; button.dataset.plannedTitle = item.title; const badge = doc.createElement("span"); badge.className = "pith-lesson-badge"; badge.textContent = "待生成"; button.append(badge); }
      staleBadge(button, item.fileName); navigation.append(button);
    }
    for (const file of document.files.filter(file => !planned.some(item => item.fileName === file.name))) {
      const button = doc.createElement("button"), title = doc.createElement("span"); button.className = "pith-lesson"; title.className = "pith-lesson-title"; title.textContent = file.name; button.append(title); button.dataset.file = file.name; button.dataset.lesson = ""; button.setAttribute("aria-current", String(document.source?.kind === "lesson" && file.name === document.currentFile)); staleBadge(button, file.name); navigation.append(button);
    }
    group("材料");
    const repositories = new Map<string, NavigationMaterial[]>();
    for (const material of document.materialGroups) { const key = material.kind === "repo" && material.externalPath ? material.externalPath : material.id; const versions = repositories.get(key) ?? []; versions.push(material); repositories.set(key, versions); }
    for (const versions of repositories.values()) {
      versions.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      const latest = versions[versions.length - 1]!, section = doc.createElement("section"); section.className = "pith-repository-group";
      const heading = doc.createElement("h3"); heading.textContent = latest.title; section.append(heading); navigation.append(section);
      if (latest.kind === "repo") {
        const actions = doc.createElement("div"); actions.className = "pith-version-actions";
        const check = doc.createElement("button"); check.textContent = "检查更新"; check.dataset.checkRepository = latest.id; actions.append(check);
        if (latest.newerVersion) { const use = doc.createElement("button"); use.textContent = `改用 @${latest.newerVersion.commitSha.slice(0, 7)}`; use.dataset.useVersion = latest.newerVersion.id; actions.append(use); }
        section.append(actions);
      }
      for (const material of [...versions].reverse()) {
        let container: HTMLElement = section;
        if (material !== latest) {
          const details = doc.createElement("details"), summary = doc.createElement("summary"); details.className = "pith-old-version";
          details.open = document.source?.kind === "material" && document.source.materialId === material.id;
          const lessons = material.basedLessons ?? []; summary.textContent = `@${material.commitSha?.slice(0, 7)} · ${lessons.length} 讲依据`; summary.title = lessons.join("、") || "无讲义依据"; details.append(summary);
          if (lessons.length) { const names = doc.createElement("small"); names.textContent = lessons.join("、"); details.append(names); }
          section.append(details); container = details;
        } else if (material.kind === "repo") { const label = doc.createElement("small"); label.className = "pith-version-label"; label.textContent = `@${material.commitSha?.slice(0, 7)} · 最新引用`; container.append(label); }
        for (const file of material.files) { const button = doc.createElement("button"); button.textContent = file.name; button.dataset.file = file.name; button.dataset.materialId = material.id; button.setAttribute("aria-current", String(document.source?.kind === "material" && document.source.materialId === material.id && file.name === document.currentFile)); container.append(button); if (document.source?.kind === "material" && document.source.materialId === material.id && file.name === document.currentFile) renderTocTree(container, document.sections, navigate, pithIcon("chevron-right")); }
      }
    }
    if (document.source?.kind === "lesson") renderTocTree(navigation, document.sections, navigate, pithIcon("chevron-right"));
    return;
  }
  if (document.curriculum?.length) {
    group("课程目录");
    for (const item of document.curriculum) {
      const button = doc.createElement("button"), title = doc.createElement("span"); button.className = "pith-lesson"; title.className = "pith-lesson-title"; title.textContent = item.title; button.append(title);
      if (item.status === "ready") { button.dataset.file = item.fileName; button.setAttribute("aria-current", String(item.fileName === document.currentFile)); }
      else { button.dataset.plannedLesson = item.fileName; button.dataset.plannedTitle = item.title; const badge = doc.createElement("span"); badge.className = "pith-lesson-badge"; badge.textContent = "待生成"; button.append(badge); }
      navigation.append(button);
      if (item.fileName === document.currentFile) renderTocTree(navigation, document.sections.filter(section => section.level >= 2), navigate, pithIcon("chevron-right"));
    }
    const extras = document.files.filter(file => !document.curriculum!.some(item => item.fileName === file.name));
    if (extras.length) { group("材料"); extras.forEach(file => fileButton(file.name)); }
  } else {
    group("材料"); document.files.forEach(file => fileButton(file.name));
    group("目录"); renderTocTree(navigation, document.sections, navigate, pithIcon("chevron-right"));
  }
}
