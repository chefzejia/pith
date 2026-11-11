import type { ReaderSectionHeading } from "../../core/index.ts";
import { renderTocTree, type CurriculumItem } from "../../plugins/stage-reader/pagination.ts";
import { pithIcon } from "../icons.ts";

export function renderNavigation(navigation: HTMLElement, document: { files: readonly { name: string }[]; curriculum?: readonly CurriculumItem[]; sections: readonly ReaderSectionHeading[]; currentFile: string }, navigate: (locator: string) => void): void {
  const doc = navigation.ownerDocument; navigation.replaceChildren();
  const group = (label: string): void => { const heading = doc.createElement("h2"); heading.textContent = label; navigation.append(heading); };
  const fileButton = (name: string): void => { const button = doc.createElement("button"); button.textContent = name; button.dataset.file = name; button.setAttribute("aria-current", String(name === document.currentFile)); navigation.append(button); };
  if (document.curriculum?.length) {
    group("课程目录");
    for (const item of document.curriculum) {
      const button = doc.createElement("button"), title = doc.createElement("span"); button.className = "pith-lesson"; title.textContent = item.title; button.append(title);
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
