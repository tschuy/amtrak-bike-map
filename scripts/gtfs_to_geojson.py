#!/usr/bin/env python3
"""Convert Amtrak GTFS and bike-access CSV data into olmap GeoJSON layers."""

import csv
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

BIKE_ACCESS = {"yes", "unreserved"}
ROUTE_ALIASES = {
    "Acela": ["Acela Express"],
    "Amtrak Hartford Line": ["Hartford Line"],
    "Amtrak Mardi Gras Service": ["Mardi Gras Service"],
    "Illini": ["Illini and Saluki"],
    "Saluki": ["Illini and Saluki"],
    "Illinois Zephyr": ["Illinois Zephyr and Carl Sandburg"],
    "Carl Sandburg": ["Illinois Zephyr and Carl Sandburg"],
    "Lincoln Service Missouri River Runner": ["Lincoln Service", "Missouri River Runner"],
}


def rows(archive: zipfile.ZipFile, filename: str):
    with archive.open(filename) as source:
        yield from csv.DictReader(line.decode("utf-8-sig") for line in source)


def load_bike_data(path: str):
    by_route = defaultdict(dict)
    with open(path, newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            by_route[row["route_name"].strip()][row["station_code"].strip().upper()] = row["bike_reservations"].strip().lower()
    return by_route


def load_route_services(path: str):
    with open(path, newline="", encoding="utf-8") as source:
        return {row["route_name"].strip(): row for row in csv.DictReader(source)}


def route_bike_rows(route_name, bike_data):
    aliases = ROUTE_ALIASES.get(route_name, [route_name])
    combined = {}
    for alias in aliases:
        for station, status in bike_data.get(alias, {}).items():
            if station not in combined or status in BIKE_ACCESS:
                combined[station] = status
    return combined


def main() -> None:
    source_path, gold_runner_path, routes_output, stops_output, summaries_output, agency_id, bike_path, services_path = sys.argv[1:9]
    bike_data = load_bike_data(bike_path)
    route_services = load_route_services(services_path)
    with zipfile.ZipFile(source_path) as archive:
        routes = {row["route_id"]: row for row in rows(archive, "routes.txt") if row["agency_id"] == agency_id}
        shape_routes = {}
        trip_routes = {}
        for trip in rows(archive, "trips.txt"):
            if trip["route_id"] in routes:
                trip_routes[trip["trip_id"]] = trip["route_id"]
                if trip.get("shape_id"):
                    shape_routes.setdefault(trip["shape_id"], trip["route_id"])

        points = defaultdict(list)
        for point in rows(archive, "shapes.txt"):
            shape_id = point["shape_id"]
            if shape_id in shape_routes:
                points[shape_id].append((int(point["shape_pt_sequence"]), [float(point["shape_pt_lon"]), float(point["shape_pt_lat"])]))

        stop_routes = defaultdict(set)
        for stop_time in rows(archive, "stop_times.txt"):
            route_id = trip_routes.get(stop_time["trip_id"])
            if route_id:
                stop_routes[stop_time["stop_id"]].add(route_id)
        stops = [stop for stop in rows(archive, "stops.txt") if stop["stop_id"] in stop_routes]

    # Gold Runner is Amtrak-branded but published in the separate SJJPA feed.
    # Only its GR rail route and non-bus-prefixed stops belong on this map.
    with zipfile.ZipFile(gold_runner_path) as archive:
        gold_route = next(
            row for row in rows(archive, "routes.txt")
            if row["route_id"] == "GR" and row["agency_id"] == "SJJPA"
        )
        gold_route = dict(gold_route)
        gold_route["route_long_name"] = "Gold Runner"
        gold_route["route_short_name"] = ""
        routes["GR"] = gold_route

        gold_trips = {
            trip["trip_id"]: trip["route_id"]
            for trip in rows(archive, "trips.txt")
            if trip["route_id"] == "GR"
        }
        gold_shapes = {
            trip["shape_id"] for trip in rows(archive, "trips.txt")
            if trip["route_id"] == "GR" and trip.get("shape_id")
        }
        for shape_id in gold_shapes:
            shape_routes[f"gold:{shape_id}"] = "GR"
        for point in rows(archive, "shapes.txt"):
            if point["shape_id"] in gold_shapes:
                points[f"gold:{point['shape_id']}"].append((
                    int(point["shape_pt_sequence"]),
                    [float(point["shape_pt_lon"]), float(point["shape_pt_lat"])],
                ))

        gold_stop_ids = set()
        for stop_time in rows(archive, "stop_times.txt"):
            if stop_time["trip_id"] in gold_trips and not stop_time["stop_id"].startswith("b"):
                gold_stop_ids.add(stop_time["stop_id"])
                stop_routes[stop_time["stop_id"]].add("GR")
        stops_by_id = {stop["stop_id"]: stop for stop in stops}
        for stop in rows(archive, "stops.txt"):
            if stop["stop_id"] in gold_stop_ids:
                stops_by_id.setdefault(stop["stop_id"], stop)
        stops = list(stops_by_id.values())

    route_features = []
    station_names = {stop.get("stop_code", "").upper(): stop["stop_name"] for stop in stops}
    route_properties = {}
    for route_id, route in routes.items():
        statuses = route_bike_rows(route["route_long_name"], bike_data)
        access_count = sum(status in BIKE_ACCESS for status in statuses.values())
        total = len(statuses)
        bike_stations = [
            {"code": code, "name": station_names.get(code, code), "status": status, "has_access": status in BIKE_ACCESS}
            for code, status in sorted(statuses.items(), key=lambda item: (station_names.get(item[0], item[0]), item[0]))
        ]
        services = route_services.get(route["route_long_name"], {})
        route_properties[route_id] = {
            "route_id": route_id,
            "route_long_name": route["route_long_name"],
            "route_short_name": route["route_short_name"],
            "route_url": route["route_url"],
            "agency_id": agency_id,
            "bike_access_count": access_count,
            "bike_no_access_count": total - access_count,
            "bike_station_count": total,
            "bike_access_percent": round(access_count / total * 100, 1) if total else 0,
            "bike_no_access_percent": round((total - access_count) / total * 100, 1) if total else 0,
            "bike_stations": json.dumps(bike_stations, separators=(",", ":")),
            "carry_on": services.get("carry_on", "no"),
            "checked": services.get("checked", "no"),
            "reservation_required": services.get("reservation_required", ""),
            "tire_width": services.get("tire_width", ""),
            "remove_wheel": services.get("remove_wheel", ""),
            "service_note": services.get("note", ""),
        }
    for shape_id, route_id in sorted(shape_routes.items()):
        coordinates = [coordinate for _, coordinate in sorted(points[shape_id])]
        if len(coordinates) < 2:
            continue
        route_features.append({
            "type": "Feature",
            "id": f"{route_id}:{shape_id}",
            "properties": route_properties[route_id],
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })

    stop_features = []
    for stop in sorted(stops, key=lambda item: item["stop_name"]):
        code = stop.get("stop_code", "").upper()
        served_routes = []
        for route_id in sorted(stop_routes[stop["stop_id"]], key=lambda item: routes[item]["route_long_name"]):
            name = routes[route_id]["route_long_name"]
            statuses = route_bike_rows(name, bike_data)
            status = statuses.get(code, "unavailable")
            served_routes.append({"route_id": route_id, "name": name, "status": status, "has_access": status in BIKE_ACCESS})
        access_count = sum(route["has_access"] for route in served_routes)
        level = "all" if served_routes and access_count == len(served_routes) else "some" if access_count else "none"
        color = {"all": "#1769d2", "some": "#6b1f78", "none": "#c43131"}[level]
        stop_features.append({
            "type": "Feature",
            "id": f"stop:{stop['stop_id']}",
            "properties": {
                "stop_id": stop["stop_id"],
                "stop_name": stop["stop_name"],
                "stop_code": code,
                "stop_url": stop.get("stop_url", ""),
                "agency_id": agency_id,
                "marker_color": color,
                "bike_access_level": level,
                "bike_routes": json.dumps(served_routes, separators=(",", ":")),
            },
            "geometry": {"type": "Point", "coordinates": [float(stop["stop_lon"]), float(stop["stop_lat"])]},
        })

    route_destination = Path(routes_output)
    stop_destination = Path(stops_output)
    summaries_destination = Path(summaries_output)
    route_destination.parent.mkdir(parents=True, exist_ok=True)
    stop_destination.parent.mkdir(parents=True, exist_ok=True)
    summaries_destination.parent.mkdir(parents=True, exist_ok=True)
    route_destination.write_text(json.dumps({"type": "FeatureCollection", "features": route_features}, separators=(",", ":")), encoding="utf-8")
    stop_destination.write_text(json.dumps({"type": "FeatureCollection", "features": stop_features}, separators=(",", ":")), encoding="utf-8")
    summaries_destination.write_text(json.dumps(list(route_properties.values()), separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(shape_routes)} shapes for {len(routes)} routes and {len(stops)} stops")


if __name__ == "__main__":
    main()
