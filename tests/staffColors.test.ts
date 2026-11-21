import assert from 'node:assert/strict';
import test from 'node:test';
import { NEUTRAL_STAFF_COLOR, STAFF_COLORS, staffColorAt, staffColorFor } from '../src/staffColors';
import { initialEmployees } from '../src/mockData';

// One colour per stylist. What is measured here: text on a colour stays readable, and a person
// keeps their colour whatever else is on screen.

/** Contrast of two colours as WCAG 2 counts it: 1 (none) to 21 (black on white). */
const contrast = (a: string, b: string): number => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

test('the contrast measure itself is right', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  // Mid grey on white is the well-known 4.5:1 border case.
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
});

test('every colour keeps its text readable, also on an appointment that is over', () => {
  const all = [...STAFF_COLORS, NEUTRAL_STAFF_COLOR];
  for (const color of all) {
    for (const value of Object.values(color).filter((item) => item !== color.name)) assert.match(value, /^#[0-9a-f]{6}$/, color.name);
    // An appointment's text is small (10 to 12 px): 7:1 and more, where 4.5:1 is the minimum for text.
    assert.ok(contrast(color.ink, color.fill) >= 7, `${color.name}: text on its fill is ${contrast(color.ink, color.fill).toFixed(1)}:1`);
    // Muted for the past, and still above the minimum.
    assert.ok(contrast(color.pastInk, color.pastFill) >= 4.5, `${color.name}: text of a past appointment is ${contrast(color.pastInk, color.pastFill).toFixed(1)}:1`);
    assert.ok(contrast(color.pastInk, color.pastFill) < contrast(color.ink, color.fill), `${color.name}: the past is paler`);
    // The strong colour is the dot in the legend and the bar at an appointment's edge: 3:1 against the page.
    assert.ok(contrast(color.accent, '#ffffff') >= 3, `${color.name}: accent on white is ${contrast(color.accent, '#ffffff').toFixed(2)}:1`);
  }
});

test('there are eight colours, none twice, and they are not cycled', () => {
  assert.equal(STAFF_COLORS.length, 8);
  for (const key of ['name', 'accent', 'fill'] as const) assert.equal(new Set(STAFF_COLORS.map((color) => color[key])).size, 8, key);
  // The salon's three stylists keep the colours the calendar always had for them.
  assert.deepEqual(STAFF_COLORS.slice(0, 3).map((color) => color.name), ['violet', 'green', 'blue']);
  // A ninth person does not share somebody's colour: grey, like a name outside the team.
  assert.equal(staffColorAt(7), STAFF_COLORS[7]);
  assert.equal(staffColorAt(8), NEUTRAL_STAFF_COLOR);
  assert.equal(staffColorAt(-1), NEUTRAL_STAFF_COLOR);
  assert.ok(!STAFF_COLORS.some((color) => color.accent === NEUTRAL_STAFF_COLOR.accent));
});

test('a colour belongs to a person, not to their place on screen', () => {
  const [anna, selina, luca] = initialEmployees;
  assert.equal(staffColorFor(initialEmployees, anna.id).name, 'violet');
  assert.equal(staffColorFor(initialEmployees, selina.id).name, 'green');
  assert.equal(staffColorFor(initialEmployees, luca.id).name, 'blue');
  // Asked again, with the same team, the answer is the same: a filter that shows only Luca still asks with the whole team.
  assert.equal(staffColorFor(initialEmployees, luca.id), staffColorFor([...initialEmployees], luca.id));
  // Somebody who is not in the team, and an appointment without a stylist.
  assert.equal(staffColorFor(initialEmployees, 'emp-unknown'), NEUTRAL_STAFF_COLOR);
  assert.equal(staffColorFor(initialEmployees, undefined), NEUTRAL_STAFF_COLOR);
});
