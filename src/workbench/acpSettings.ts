import type { AcpConfigOptionDescriptor } from "../core/index.ts";

export function findAcpModelOption(options: readonly AcpConfigOptionDescriptor[]): AcpConfigOptionDescriptor | undefined {
  return options.find(item => item.id === "model" || item.category === "model");
}

export function findAcpEffortOption(options: readonly AcpConfigOptionDescriptor[]): AcpConfigOptionDescriptor | undefined {
  return options.find(item => item.category === "thought_level" || item.id === "reasoning_effort" || item.id === "effort" || item.id === "thought_level");
}

export function renderAcpSelect(select: HTMLSelectElement, descriptor: AcpConfigOptionDescriptor | undefined, value: string): void {
  const doc = select.ownerDocument;
  select.replaceChildren();
  const current = descriptor && descriptor.options.find(option => option.value === descriptor.currentValue);
  const defaultOption = doc.createElement("option"); defaultOption.value = "";
  defaultOption.textContent = descriptor && descriptor.currentValue ? `默认（跟随 Agent 当前默认：${current ? current.name : descriptor.currentValue}）` : "默认（跟随 Agent 当前默认）";
  select.append(defaultOption);
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const choice of descriptor ? descriptor.options : []) {
    const option = doc.createElement("option"); option.value = choice.value; option.textContent = choice.name;
    if (choice.description) option.title = choice.description;
    if (choice.group !== undefined) {
      let group = groups.get(choice.group);
      if (!group) { group = doc.createElement("optgroup"); group.label = choice.groupLabel ?? choice.group; groups.set(choice.group, group); select.append(group); }
      group.append(option);
    } else select.append(option);
  }
  if (value && !(descriptor && descriptor.options.some(choice => choice.value === value))) { const option = doc.createElement("option"); option.value = value; option.textContent = value; select.append(option); }
  select.value = value;
}
