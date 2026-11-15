export function distanceKm(a, b) {
  if (!a || !b) return null;
  const r = Math.PI / 180,
    dLat = (b[1] - a[1]) * r,
    dLon = (b[0] - a[0]) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export const minutes = (t) =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const clock = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(
    2,
    "0"
  )}`;
export function groupCost(a, input) {
  const p = a.priceInformation;
  if (!p?.known || p.adult == null || p.currency !== "USD") return null;
  if (p.perGroup) return p.adult;
  if (input.childAges.length && p.child == null) return null;
  return (
    Math.round(
      (p.adult * input.adults + (p.child || 0) * input.childAges.length) * 100
    ) / 100
  );
}
export function hoursStatus(a, date, start, duration, now = new Date()) {
  const h = a.operatingHours;
  if (
    !h?.verified ||
    !h.validUntil ||
    new Date(h.validUntil) < now ||
    new Date(h.validUntil).toISOString().slice(0, 10) < date
  )
    return "unknown";
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const intervals = (h.weekly || []).flatMap((w) => {
    const open = minutes(w.open),
      close = minutes(w.close);
    if (w.day === day) return [[open, close > open ? close : close + 1440]];
    if (w.day === (day + 6) % 7 && close <= open) return [[0, close]];
    return [];
  });
  return intervals.some(
    ([open, close]) => start >= open && start + duration <= close
  )
    ? "open"
    : "closed";
}
export function eligible(a, input) {
  const cost = groupCost(a, input),
    ages = input.childAges,
    age = a.ageSuitability;
  if (input.exclude.includes(String(a._id))) return false;
  if (age?.min != null && ages.some((v) => v < age.min)) return false;
  if (age?.max != null && (age.max < 18 || ages.some((v) => v > age.max)))
    return false;
  if (
    input.environment !== "any" &&
    a.environment !== input.environment &&
    a.environment !== "mixed"
  )
    return false;
  if (input.strictBudget && (cost === null || cost > input.budget))
    return false;
  const distance = distanceKm(input.start, a.coordinates?.coordinates);
  if (distance === null || distance > input.radiusKm) return false;
  if (a.expiresAt && new Date(a.expiresAt) <= new Date()) return false;
  return true;
}
export function rankActivities(
  activities,
  input,
  weights = { interest: 30, budget: 25, distance: 20, time: 15, novelty: 10 }
) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 100;
  return activities
    .filter((a) => eligible(a, input))
    .map((a) => {
      const cost = groupCost(a, input),
        distance = distanceKm(input.start, a.coordinates?.coordinates);
      const matches =
        a.categories?.filter((c) => input.interests.includes(String(c)))
          .length || 0;
      const duration = a.estimatedDuration?.max ?? 90;
      const modeMatch =
        (a.audience || []).includes(input.mode) ||
        (a.tags || []).includes(
          input.mode === "local" ? "local-favorite" : "sightseeing"
        );
      const fit = {
        interest: input.interests.length
          ? Math.min(1, matches / input.interests.length)
          : 0.5,
        budget:
          cost == null
            ? 0
            : input.budget === 0
            ? 1
            : Math.max(0, 1 - cost / input.budget),
        distance: Math.max(0, 1 - distance / input.radiusKm),
        time: Math.min(
          1,
          (minutes(input.endTime) - minutes(input.startTime)) / duration
        ),
        novelty:
          (input.visited.includes(String(a._id)) ? 0 : 0.7) +
          (modeMatch ? 0.3 : 0),
      };
      const weather = input.weather || "any";
      const weatherMatch =
        weather !== "any" && (a.weatherSuitability || []).includes(weather);
      if (weather !== "any" && a.weatherSuitability?.length)
        fit.interest = fit.interest * 0.8 + (weatherMatch ? 0.2 : 0);
      const reasons = [];
      if (weatherMatch)
        reasons.push("Listed as suitable for your selected weather conditions");
      if (matches) reasons.push("Matches your interests");
      if (modeMatch)
        reasons.push(
          input.mode === "local"
            ? "Matches your preference for local discovery"
            : "Matches your interest in sightseeing"
        );
      if (cost === 0)
        reasons.push("Free admission based on the listed information");
      else if (cost !== null)
        reasons.push(`Estimated group admission: $${cost.toFixed(2)}`);
      reasons.push(
        `About ${distance.toFixed(
          1
        )} km from your starting point in a straight line`
      );
      if (!input.visited.includes(String(a._id)))
        reasons.push("Something you have not marked as visited");
      return {
        activity: a,
        cost,
        distanceKm: distance,
        score: Math.round(
          (Object.entries(fit).reduce(
            (sum, [key, value]) => sum + value * (weights[key] || 0),
            0
          ) /
            total) *
            100
        ),
        reasons,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.activity._id).localeCompare(String(b.activity._id))
    );
}
export function generatePlan(activities, input, weights, ordered = false) {
  const from = minutes(input.startTime),
    until = minutes(input.endTime);
  if (until <= from)
    throw Object.assign(
      new Error("End time must be later than start time on the same day"),
      { status: 422 }
    );
  let ranked = rankActivities(activities, input, weights);
  if (ordered) {
    const byId = new Map(ranked.map((r) => [String(r.activity._id), r]));
    if (new Set(input.stopIds).size !== input.stopIds.length)
      throw Object.assign(new Error("A stop cannot appear twice"), {
        status: 422,
      });
    if (input.stopIds.some((id) => !byId.has(id)))
      throw Object.assign(
        new Error(
          "A selected stop is no longer available or does not meet the current constraints"
        ),
        { status: 422 }
      );
    ranked = input.stopIds.map((id) => byId.get(id));
  }
  let current = from,
    position = input.start,
    spent = 0,
    mealAdded = false;
  const stops = [],
    breaks = [],
    warnings = new Set([
      "Travel times are rough geographic estimates, not verified routes. Allow extra time for traffic, parking and queues.",
    ]);
  const speeds = { walking: 4, cycling: 12, driving: 25, transit: 15 },
    breakLength = { relaxed: 25, balanced: 15, active: 5 };
  for (const item of ranked) {
    const a = item.activity,
      cost = item.cost,
      distance = distanceKm(position, a.coordinates?.coordinates);
    const travel = Math.max(
      5,
      Math.ceil(((distance * 1.35) / speeds[input.transport]) * 60)
    );
    const duration = a.estimatedDuration?.max ?? 90;
    const meal = input.meals && !mealAdded && current + travel >= 720 ? 45 : 0;
    let arrival = current + travel + meal;
    const opening = hoursStatus(a, input.date, arrival, duration);
    const fits =
      arrival + duration <= until &&
      (cost == null || spent + cost <= input.budget) &&
      opening !== "closed";
    if (!fits) {
      if (ordered)
        throw Object.assign(
          new Error(
            `The revised plan cannot fit ${a.title}. Change time, order or budget.`
          ),
          { status: 422 }
        );
      continue;
    }
    if (meal) {
      breaks.push({
        type: "meal",
        startTime: clock(current),
        endTime: clock(current + meal),
        note: "Time reserved for a meal. Restaurant and food cost are not included.",
      });
      mealAdded = true;
      warnings.add(
        "Meals, transport, taxes and fees are outside the admission estimate."
      );
    }
    const notes = [];
    if (opening === "unknown")
      notes.push(
        "Opening hours are unverified for this date. Check with the venue."
      );
    if (!a.estimatedDuration)
      notes.push(
        "90-minute planning allowance; actual visit duration is unknown."
      );
    if (cost === null) {
      notes.push("Price unknown; excluded from the known cost subtotal.");
      warnings.add("Some costs are unknown. This is not a confirmed total.");
    }
    if (a.verificationStatus !== "verified")
      notes.push("Venue information has not been independently verified.");
    if (a.reservationRequired)
      notes.push("Reservation required. Check availability before traveling.");
    stops.push({
      activity: a,
      startTime: clock(arrival),
      endTime: clock(arrival + duration),
      durationMinutes: duration,
      travel: {
        minutes: travel,
        distanceKm: Math.round(distance * 10) / 10,
        kind: "rough-geographic-estimate",
      },
      groupCost: cost,
      reasons: item.reasons,
      warnings: notes,
    });
    spent += cost || 0;
    current = arrival + duration;
    position = a.coordinates.coordinates;
    if (current + breakLength[input.pace] < until) {
      breaks.push({
        type: "rest",
        startTime: clock(current),
        endTime: clock(current + breakLength[input.pace]),
        note: "A little breathing room",
      });
      current += breakLength[input.pace];
    }
    if (
      stops.length >=
      (ordered
        ? 15
        : input.pace === "relaxed"
        ? 4
        : input.pace === "active"
        ? 8
        : 6)
    )
      break;
  }
  if (!stops.length)
    warnings.add(
      "No activities meet these constraints. Try a wider radius, another time, or allow unknown prices."
    );
  if (!input.strictBudget)
    warnings.add("Unknown prices are allowed. Confirm costs before booking.");
  return {
    date: input.date,
    input,
    stops,
    breaks,
    knownAdmissionTotal: Math.round(spent * 100) / 100,
    remainingAdmissionBudget: Math.round((input.budget - spent) * 100) / 100,
    unknownCostCount: stops.filter((s) => s.groupCost === null).length,
    warnings: [...warnings],
    generatedAt: new Date().toISOString(),
  };
}
