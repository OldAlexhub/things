import test from "node:test";
import assert from "node:assert/strict";
import {
  distanceKm,
  groupCost,
  generatePlan,
  rankActivities,
  hoursStatus,
} from "../services/planner.js";
import { planning, validateRecord } from "../lib/validation.js";
const input = planning.parse({
  cityId: "507f1f77bcf86cd799439011",
  date: "2026-11-14",
  budget: 50,
  start: [-81.38, 28.54],
  adults: 2,
  childAges: [5, 12],
  meals: false,
});
const place = (extra = {}) => ({
  _id: "507f1f77bcf86cd799439012",
  title: "Test park",
  categories: [],
  coordinates: { coordinates: [-81.381, 28.541] },
  priceInformation: { known: true, adult: 10, child: 5, currency: "USD" },
  estimatedDuration: { min: 60, max: 90 },
  ...extra,
});
test("group admission accounts for adults and each child", () =>
  assert.equal(groupCost(place(), input), 30));
test("unknown child admission stays unknown", () =>
  assert.equal(
    groupCost(
      place({ priceInformation: { known: true, adult: 10, currency: "USD" } }),
      input
    ),
    null
  ));
test("zero budget includes free activities, excludes unknown and paid", () => {
  const free = place({
    priceInformation: { known: true, adult: 0, child: 0, currency: "USD" },
  });
  assert.equal(
    rankActivities(
      [free, place({ priceInformation: { known: false } }), place()],
      { ...input, budget: 0 }
    ).length,
    1
  );
});
test("mandatory age restrictions applied before ranking", () =>
  assert.equal(
    rankActivities([place({ ageSuitability: { min: 18 } })], input).length,
    0
  ));
test("geographic distance is sensible and unknown coordinates are excluded", () => {
  assert.equal(distanceKm([0, 0], [0, 0]), 0);
  assert.ok(distanceKm([0, 0], [1, 0]) > 110);
  assert.equal(
    rankActivities([place({ coordinates: undefined })], input).length,
    0
  );
});
test("closed verified hours are not scheduled", () => {
  const a = place({
    operatingHours: {
      verified: true,
      validUntil: "2099-01-01",
      weekly: [{ day: 6, open: "19:00", close: "20:00" }],
    },
  });
  assert.equal(generatePlan([a], input).stops.length, 0);
});
test("expired verified hours become unknown", () =>
  assert.equal(
    hoursStatus(
      place({
        operatingHours: {
          verified: true,
          validUntil: "2020-01-01",
          weekly: [],
        },
      }),
      input.date,
      600,
      60
    ),
    "unknown"
  ));
test("overnight hours include the next-day portion", () => {
  const a = place({
    operatingHours: {
      verified: true,
      validUntil: "2099-01-01",
      weekly: [{ day: 5, open: "22:00", close: "02:00" }],
    },
  });
  assert.equal(hoursStatus(a, "2026-11-14", 30, 60), "open");
});
test("planner keeps costs and travel inside the day", () => {
  const p = generatePlan(
    [place(), place({ _id: "507f1f77bcf86cd799439013" })],
    input
  );
  assert.equal(p.stops.length, 1);
  assert.equal(p.knownAdmissionTotal, 30);
  assert.equal(p.stops[0].travel.kind, "rough-geographic-estimate");
  assert.ok(p.stops[0].startTime > input.startTime);
});
test("recalculation rejects an unaffordable order instead of silently dropping stops", () =>
  assert.throws(
    () =>
      generatePlan(
        [place(), place({ _id: "507f1f77bcf86cd799439013" })],
        {
          ...input,
          stopIds: ["507f1f77bcf86cd799439012", "507f1f77bcf86cd799439013"],
        },
        undefined,
        true
      ),
    /cannot fit/
  ));
test("invalid dates, coordinates and injected fields fail validation", () => {
  assert.throws(() => planning.parse({ ...input, date: "2026-02-30" }));
  assert.throws(() => planning.parse({ ...input, start: [400, 28] }));
  assert.throws(() => planning.parse({ ...input, $where: "evil" }));
});
test("empty results return actionable warnings", () => {
  const p = generatePlan([], input);
  assert.equal(p.stops.length, 0);
  assert.ok(p.warnings.some((w) => w.startsWith("No activities")));
});
test("per-group prices are not multiplied", () =>
  assert.equal(
    groupCost(
      place({
        priceInformation: {
          known: true,
          adult: 25,
          perGroup: true,
          currency: "USD",
        },
      }),
      input
    ),
    25
  ));
test("unknown costs can be included only with explicit allowance", () => {
  const p = generatePlan([place({ priceInformation: { known: false } })], {
    ...input,
    strictBudget: false,
  });
  assert.equal(p.unknownCostCount, 1);
  assert.equal(p.knownAdmissionTotal, 0);
});

test('listed weather fit affects ranking without inventing a forecast',()=>{
 const rain=place({_id:'rain',weatherSuitability:['rain']}),dry=place({_id:'dry',weatherSuitability:['dry']});
 const ranked=rankActivities([dry,rain],{...input,weather:'rain'});
 assert.equal(ranked[0].activity._id,'rain');assert.ok(ranked[0].reasons.some(r=>r.includes('weather')));
});
test('city planning templates accept only supported data fields',()=>{
 const city={name:'Test city',slug:'test-city',state:'FL',country:'USA',timezone:'America/New_York',latitude:28,longitude:-81,description:'Test only',planTemplates:[{key:'morning',title:'Morning plan',defaults:{startTime:'09:00',endTime:'13:00',weather:'rain'}}]};
 assert.equal(validateRecord('cities',city).planTemplates[0].defaults.weather,'rain');
 assert.throws(()=>validateRecord('cities',{...city,planTemplates:[{...city.planTemplates[0],defaults:{script:'alert(1)'}}]}));
});
