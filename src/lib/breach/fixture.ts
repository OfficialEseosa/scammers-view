import { sortNewestFirst } from "./normalise";
import type { BreachResult } from "./types";

/** Fictional breaches for demos and tests. No real service or person. */
export const FIXTURE_BREACHES: BreachResult = {
  provider: "hibp",
  checkedAt: "2026-01-15T10:00:00.000Z",
  breaches: sortNewestFirst([
    { name: "Maplewood Forum", domain: "maplewood-forum.example", date: "2023-06-02", dataClasses: ["Email addresses", "Passwords", "Usernames", "IP addresses"], verified: true },
    { name: "Brightpath Learning", domain: "brightpath-learning.example", date: "2021-03-18", dataClasses: ["Email addresses", "Names", "Phone numbers", "Physical addresses", "Dates of birth"], verified: true },
    { name: "Corner Pizza Orders", domain: "cornerpizza.example", date: "2019-11-09", dataClasses: ["Email addresses", "Passwords", "Phone numbers", "Physical addresses"], verified: true },
    { name: "Quizzical", domain: "quizzical.example", date: "2018-07-21", dataClasses: ["Email addresses", "Security questions and answers", "Password hints"], verified: false },
    { name: "Lakeside Gym", domain: "lakesidegym.example", date: "2016-02-14", dataClasses: ["Email addresses", "Names", "Passwords"], verified: true },
    { name: "OldBlog Network", domain: "oldblog.example", date: "2014-09-30", dataClasses: ["Email addresses", "Usernames"], verified: true },
    { name: "Retro Games Hub", domain: "retrogames.example", date: "2012-05-05", dataClasses: ["Email addresses", "Passwords", "Dates of birth"], verified: true },
  ]),
};

export const FIXTURE_CLEAN: BreachResult = { provider: "hibp", checkedAt: "2026-01-15T10:00:00.000Z", breaches: [] };
