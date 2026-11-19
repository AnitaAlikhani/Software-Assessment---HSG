import assert from 'node:assert/strict';
import test from 'node:test';
import { chatCopy } from '../src/CustomerChat';
import {
  CHAT_RETENTION_DAYS, chatsToDelete, dueEarlierChats, MAX_EARLIER_CHATS, parseEarlierChats, rememberEarlierChat, settleEarlierChats,
  type EarlierChat,
} from '../src/customerNotice';
import { FIXED_NOW } from './fixedClock';

/**
 * The website chat says "You can delete your chat at any time". "New chat" leaves the chat before
 * it at the salon, so the device remembers the ids of its earlier chats and "Delete chat" deletes
 * those too. These tests cover what the device keeps and what the customer is told about it.
 * No real clock: every time is counted from FIXED_NOW.
 */
const NOW = FIXED_NOW.getTime();
const DAY = 24 * 60 * 60 * 1000;
const RETENTION = CHAT_RETENTION_DAYS * DAY;
const id = (n: number) => `chat${String(n).padStart(16, '0')}`;

test('"New chat" puts the chat before it on the device\'s list, for the period the salon keeps it', () => {
  let list = rememberEarlierChat([], id(1), NOW);
  assert.deepEqual(list, [{ id: id(1), until: NOW + RETENTION }]);
  list = rememberEarlierChat(list!, id(2), NOW + DAY);
  assert.deepEqual(list, [{ id: id(1), until: NOW + RETENTION }, { id: id(2), until: NOW + DAY + RETENTION }]);
  // The same chat set aside again is listed once, with the later time.
  assert.deepEqual(rememberEarlierChat(list!, id(1), NOW + 2 * DAY), [
    { id: id(2), until: NOW + DAY + RETENTION }, { id: id(1), until: NOW + 2 * DAY + RETENTION },
  ]);
  // Nothing but an id of the form the chat route accepts is ever put on the list.
  for (const bad of ['', 'short', 'UPPERCASE0000000000', 'with space 00000000', '../../etc/passwd']) {
    assert.deepEqual(rememberEarlierChat(list!, bad, NOW), list, bad);
  }
});

test('the list is short, and a full list does not push a chat off: another chat cannot be set aside', () => {
  let list: EarlierChat[] = [];
  for (let n = 1; n <= MAX_EARLIER_CHATS; n += 1) list = rememberEarlierChat(list, id(n), NOW)!;
  assert.equal(list.length, MAX_EARLIER_CHATS);
  assert.ok(MAX_EARLIER_CHATS <= 10);
  assert.equal(rememberEarlierChat(list, id(99), NOW), null);
  // A chat that is on the list already can still be set aside again.
  assert.equal(rememberEarlierChat(list, id(1), NOW)?.length, MAX_EARLIER_CHATS);
});

test('what the device stored is read back strictly: ids and times only', () => {
  const list = [{ id: id(1), until: NOW + DAY }, { id: id(2), until: NOW + 2 * DAY }];
  assert.deepEqual(parseEarlierChats(JSON.stringify(list)), list);
  // Anything else that may sit in the storage is dropped, also extra fields beside an id.
  const messy = [
    { id: id(1), until: NOW + DAY, name: 'Mia', messages: ['hello'] }, { id: id(1), until: NOW }, { id: 'not an id', until: NOW },
    { id: id(3) }, { id: id(4), until: 'tomorrow' }, null, 'text', 42,
  ];
  assert.deepEqual(parseEarlierChats(JSON.stringify(messy)), [{ id: id(1), until: NOW + DAY }]);
  for (const broken of [null, '', 'not json', '{"id":"x"}', '"text"', '42']) assert.deepEqual(parseEarlierChats(broken), [], String(broken));
  const tooMany = Array.from({ length: 30 }, (_, n) => ({ id: id(n), until: NOW }));
  assert.equal(parseEarlierChats(JSON.stringify(tooMany)).length, MAX_EARLIER_CHATS);
});

test('an id is dropped when its chat is gone at the salon, and kept while the salon still has the chat', () => {
  const list = [{ id: id(1), until: NOW - DAY }, { id: id(2), until: NOW - 1 }, { id: id(3), until: NOW + DAY }];
  // Only chats whose period is over are asked about.
  assert.deepEqual(dueEarlierChats(list, NOW).map(chat => chat.id), [id(1), id(2)]);
  assert.deepEqual(dueEarlierChats(list, NOW - 2 * DAY), []);
  // Gone: forgotten. Still there (the salon wrote in it later): asked about again tomorrow.
  assert.deepEqual(settleEarlierChats(list, { [id(1)]: 'gone', [id(2)]: 'kept' }, NOW),
    [{ id: id(2), until: NOW + DAY }, { id: id(3), until: NOW + DAY }]);
  // An answer about a chat whose period is not over changes nothing.
  assert.deepEqual(settleEarlierChats(list, { [id(3)]: 'gone' }, NOW), list);
  // No answer (offline): kept, so the chat can still be deleted later ...
  assert.deepEqual(settleEarlierChats(list, {}, NOW), list);
  // ... but not for ever: after a second period without any answer the id is dropped.
  assert.deepEqual(settleEarlierChats(list, {}, NOW + RETENTION - 2 * DAY).map(chat => chat.id), [id(1), id(2), id(3)]);
  assert.deepEqual(settleEarlierChats(list, {}, NOW + RETENTION + DAY).map(chat => chat.id), [id(3)]);
  assert.deepEqual(settleEarlierChats(list, {}, NOW + 3 * RETENTION), []);
});

test('the customer is told plainly what "New chat" and "Delete chat" do with earlier chats', () => {
  for (const study of [false, true]) {
    const none = chatCopy(study, 'Salon Test', '');
    assert.equal(none.deleteTitle, 'Delete this chat?');
    assert.match(none.deleteText, /^Your messages are deleted on this device and at the salon\./);
    assert.equal(none.deleted, 'Your chat has been deleted.');
    // The promise on the start screen, and what stands behind it.
    assert.match(none.privacy, /You can delete your chat at any time\.$/);
    assert.ok(none.details.some(line => /“Delete chat” in the chat menu removes it at once, together with earlier chats you started on this device\./.test(line)));
    assert.ok(none.details.some(line => /When you start a new chat, it also keeps a reference to the chat before \(no messages\), so that “Delete chat” can remove that one too\./.test(line)));
    // Both ways into a new chat say what happens to the chat that is left.
    assert.equal(none.newChatNote, 'A new chat starts empty. The salon keeps this one until it is deleted automatically, and “Delete chat” removes it too.');

    const one = chatCopy(study, 'Salon Test', '', 1);
    assert.equal(one.deleteTitle, 'Delete this chat and 1 earlier chat?');
    assert.match(one.deleteText, /^Your messages in this chat and in the 1 earlier chat you started on this device are deleted here and at the salon\./);
    const three = chatCopy(study, 'Salon Test', '', 3);
    assert.equal(three.deleteTitle, 'Delete this chat and 3 earlier chats?');
    assert.match(three.deleteText, /in the 3 earlier chats you started on this device/);
    assert.equal(three.deletedAll, 'Your chats have been deleted.');
    assert.equal(three.notDeleted, 'Not all of your chats could be deleted. Please try again.');
    assert.match(three.tooManyChats, new RegExp(`^This device has ${MAX_EARLIER_CHATS} earlier chats\\. Choose “Delete chat”`));
  }
});

test('"Delete chat" asks the salon for every remembered chat first and for the chat on screen last', () => {
  const list = [{ id: id(1), until: NOW + DAY }, { id: id(2), until: NOW + 2 * DAY }];
  assert.deepEqual(chatsToDelete(list, id(3)), [id(1), id(2), id(3)]);
  assert.deepEqual(chatsToDelete([], id(3)), [id(3)]);
  // The chat on screen is asked for once, also when it is on the list itself.
  assert.deepEqual(chatsToDelete([...list, { id: id(3), until: NOW }], id(3)), [id(1), id(2), id(3)]);
});
