export const DEVICE_TYPE_CONFIGS = [
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
        // Z-serial Utility Connect devices are not energy monitors on the cloud API: they are
        // served by the dedicated `utility-connects` endpoints, which do not accept circuit_ids.
        endpoint: "utility-connects",
        responseType: "UtilityConnectsResponse",
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
export const DEVICE_TYPE_CONFIGS_BY_TYPE = Object.fromEntries(DEVICE_TYPE_CONFIGS.map((d) => [d.type, d]));
