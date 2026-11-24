import assert from "node:assert/strict";

export async function verifyThreadWindows({ main, other, work, homeBot, attach, until, messages, pages, remote }) {
  await main.menu(`[data-sidebar-bot-row="${work.id}"]`);
  const isChat = thread => p => new URL(p.url).searchParams.get("chatWindow") === thread;
  const first = await attach(isChat(work.activeTaskId), "first chat window");
  const { task } = await main.control("create_task", { target_type: "bot", target_id: work.id, title: "Studio sketches" });
  if (remote) {
    await main.menu(`[data-sidebar-bot-row="${work.id}"]`, "View threads");
    await main.menu(`[data-conversation="${task.taskId}"] [data-sidebar-thread-row]`);
  } else {
    await main.evaluate('localStorage.setItem("omb-advanced-mode","1"); location.reload()');
    const selectBot = `document.querySelector('[data-sidebar-bot-row="${work.id}"]')`;
    await until(() => main.evaluate(`Boolean(${selectBot})`), "advanced sidebar");
    await until(() => main.evaluate(`Boolean(${selectBot}?.parentElement.querySelector("button[aria-expanded]"))`), "thread disclosure");
    await main.evaluate(`${selectBot}.parentElement.querySelector('button[aria-expanded="false"]')?.click()`, true);
    await main.menu(`[data-sidebar-thread-row="${task.taskId}"]`);
  }
  const second = await attach(isChat(task.taskId), "second chat window");
  async function compose(page, text) {
    await until(() => page.evaluate('Boolean(document.querySelector("[data-chat-window] textarea:not([disabled])"))'), "pinned chat composer");
    await page.evaluate(`(() => { const el = document.querySelector("[data-chat-window] textarea"); el.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,${JSON.stringify(text)}); el.dispatchEvent(new Event("input",{bubbles:true})); })()`);
    await page.evaluate('document.querySelector("[data-chat-window] textarea").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",code:"Enter",bubbles:true,cancelable:true}))', true);
  }
  await Promise.all([compose(first, "Amber window reply"), compose(second, "Indigo window reply")]);
  for (const [page, thread, ours, sibling, reply] of [[first, work.activeTaskId, "Amber window reply", "Indigo window reply", "Amber received."], [second, task.taskId, "Indigo window reply", "Amber window reply", "Indigo received."]]) {
    const history = await until(async () => {
      const { messages: rows } = await messages(page, work, thread);
      return rows.some(m => m.role === "bot" && m.text === reply) && rows;
    }, `a reply to ${ours}`);
    assert.equal(history.filter(m => m.role === "user" && m.text === ours).length, 1);
    assert.ok(!history.some(m => m.role === "user" && m.text === sibling));
    await until(() => page.evaluate(`document.body.innerText.includes(${JSON.stringify(reply)})`), "visible transcript");
    assert.ok(!(await page.evaluate("document.body.innerText")).includes(sibling));
  }
  assert.equal(await main.evaluate(`(window.ombChatWindow ?? window.ogb.workspaces).openThread(${JSON.stringify(work.id)},${JSON.stringify(task.taskId)})`, true), true);
  assert.equal((await pages()).filter(isChat(task.taskId)).length, 1);
  if (remote) {
    const { channel } = await other.control("create_channel", { name: "Studio room", member_ids: [homeBot.id] });
    await other.menu(`[data-sidebar-group-row="${channel.id}"]`);
    const group = await attach(isChat(channel.activeTaskId), "group conversation");
    await until(() => group.evaluate('Boolean(document.querySelector("[data-chat-window] textarea"))'), "group composer");
    assert.equal(new URL(group.url).origin, saved[1].origin);
    const { task: topic } = await other.control("create_task", { target_type: "channel", target_id: channel.id, title: "Second room topic" });
    assert.equal(await other.evaluate(`window.ombChatWindow.openThread(${JSON.stringify(channel.id)}, ${JSON.stringify(topic.taskId)})`, true), true);
    const secondGroup = await attach(isChat(topic.taskId), "second group thread");
    await Promise.all([compose(group, "Original room window"), compose(secondGroup, "Second room window")]);
    for (const [id, here, elsewhere] of [[channel.activeTaskId, "Original room window", "Second room window"], [topic.taskId, "Second room window", "Original room window"]]) {
      const history = await until(async () => {
        const { messages: rows } = await other.control("get_channel_messages", { channel_id: channel.id, task_id: id });
        return rows.some(message => message.text === here) && rows;
      }, here);
      assert.ok(!history.some(message => message.text === elsewhere));
    }
    await secondGroup.close();
    await group.close();
  }
  await other.menu(`[data-sidebar-bot-row="${homeBot.id}"]`);
  const personalChat = await attach(isChat(homeBot.activeTaskId), "chat belonging to Personal");
  assert.equal(new URL(personalChat.url).origin, new URL(other.url).origin);
  await other.close();
  await until(() => personalChat.evaluate('document.body.innerText.includes("Personal fixture note")'), "Personal chat after workspace window closed");
  await personalChat.close();
  await first.close();
  assert.ok((await second.evaluate("document.body.innerText")).includes("Indigo window reply"));
}
