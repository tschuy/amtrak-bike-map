#!/usr/bin/env python3
"""Report route and station bike-access statistics from bike-reservations.csv."""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path


ACCEPTS_BIKES = {"yes", "unreserved"}
EXPECTED_STATUSES = ACCEPTS_BIKES | {"no"}


def load_data(
    csv_path: Path,
) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    """Return bike statuses grouped by route and by station."""
    by_route: dict[str, dict[str, str]] = defaultdict(dict)
    by_station: dict[str, dict[str, str]] = defaultdict(dict)
    unexpected_statuses: set[str] = set()

    with csv_path.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        required = {"route_name", "station_code", "bike_reservations"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(
                f"{csv_path} is missing required columns: {', '.join(sorted(missing))}"
            )

        for line_number, row in enumerate(reader, start=2):
            route = row["route_name"].strip()
            station = row["station_code"].strip().upper()
            status = row["bike_reservations"].strip().lower()
            if not route or not station:
                raise ValueError(f"missing route or station on CSV line {line_number}")
            if not status:
                raise ValueError(
                    f"missing bike_reservations value on CSV line {line_number}"
                )
            if status not in EXPECTED_STATUSES:
                unexpected_statuses.add(status)
            if station in by_route[route] and by_route[route][station] != status:
                raise ValueError(
                    f"conflicting values for {route} at {station} on CSV line "
                    f"{line_number}"
                )

            by_route[route][station] = status
            by_station[station][route] = status

    if unexpected_statuses:
        values = ", ".join(repr(value) for value in sorted(unexpected_statuses))
        print(
            f"warning: treating unexpected status values as not accepting bikes: "
            f"{values}",
            file=sys.stderr,
        )

    return dict(by_route), dict(by_station)


def print_report(
    by_route: dict[str, dict[str, str]],
    by_station: dict[str, dict[str, str]],
) -> None:
    print("Routes by percentage of stations accepting bikes")
    print("------------------------------------------------")
    route_rows = []
    for route, stations in by_route.items():
        accepted = sum(status in ACCEPTS_BIKES for status in stations.values())
        total = len(stations)
        percentage = accepted / total * 100 if total else 0.0
        route_rows.append((percentage, route, accepted, total))

    for percentage, route, accepted, total in sorted(
        route_rows, key=lambda row: (-row[0], row[1].casefold())
    ):
        print(f"{percentage:6.1f}%  {accepted:3}/{total:<3}  {route}")

    print("\nStations with mixed bike access")
    print("-------------------------------")
    mixed_count = 0
    for station, routes in sorted(by_station.items()):
        accepting = sorted(
            route for route, status in routes.items() if status in ACCEPTS_BIKES
        )
        not_accepting = sorted(
            route for route, status in routes.items() if status not in ACCEPTS_BIKES
        )
        if accepting and not_accepting:
            mixed_count += 1
            print(f"{station}")
            print(f"  accepts: {', '.join(accepting)}")
            print(f"  does not accept: {', '.join(not_accepting)}")

    if not mixed_count:
        print("None")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "csv_file",
        nargs="?",
        type=Path,
        default=Path(__file__).with_name("bike-reservations.csv"),
        help="input CSV (default: bike-reservations.csv beside this script)",
    )
    args = parser.parse_args()

    try:
        by_route, by_station = load_data(args.csv_file)
    except (OSError, ValueError, csv.Error) as error:
        parser.error(str(error))

    print_report(by_route, by_station)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
