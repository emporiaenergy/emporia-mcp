import { DeviceType, DeviceTypeConfig } from "../types/api.js";

export const DEVICE_TYPE_CONFIGS: DeviceTypeConfig[] = [
  {
    type: "vue1",
    endpoint: "energy-monitors",
    responseType: "EnergyMonitorsResponse",
    firstChars: ["0", "X"], // Vue 1: '0' or 'XXXX'
  },
  {
    type: "vue2",
    endpoint: "energy-monitors",
    responseType: "EnergyMonitorsResponse",
    firstChars: ["A"],
  },
  {
    type: "vue3",
    endpoint: "energy-monitors",
    responseType: "EnergyMonitorsResponse",
    firstChars: ["F"],
  },
  {
    type: "vueutility",
    endpoint: "energy-monitors",
    responseType: "EnergyMonitorsResponse",
    firstChars: ["Z"],
  },
  {
    type: "smartplug",
    endpoint: "outlets",
    responseType: "OutletsResponse",
    firstChars: ["B"],
  },
  {
    type: "evse",
    endpoint: "evses",
    responseType: "EvseResponse",
    firstChars: ["D"],
  },
  {
    type: "battery",
    endpoint: "batteries",
    responseType: "BatteriesResponse",
    firstChars: ["S"], // May need to expand in future
  },
];

export const DEVICE_TYPE_CONFIGS_BY_TYPE = Object.fromEntries(DEVICE_TYPE_CONFIGS.map((d) => [d.type, d])) as Record<DeviceType, DeviceTypeConfig>;
