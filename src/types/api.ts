// Define interfaces for API responses
export interface LatitudeLongitude {
  latitude: number;
  longitude: number;
}

export type MeteredTimeResolution = "MINUTES" | "FIFTEEN_MINUTES" | "HOURS" | "DAYS" | "WEEKS" | "MONTHS" | "YEARS";

export interface LocationInformation {
  heatSource?: string;
  locationSqFt?: string;
  numElectricCars?: string;
  locationType?: string;
  hotTub?: string;
  airConditioning?: string;
  swimmingPool?: string;
  numPeople?: string;
  primaryVehicleBrand?: string | null;
  [key: string]: any;
}

export interface LocationProperties {
  displayName: string;
  latitudeLongitude: LatitudeLongitude | null;
  timeZone: string;
  utilityRateGid: number | null;
  billingCycleStartDay: number;
  deviceGid: number;
  locationInformation: LocationInformation | null;
  usageCentPerKwHour: number;
  zipCode: string | null;
  peakDemandDollarPerKw: number | null;
  deviceName: string;
}

export interface Channel {
  deviceGid: number;
  name: string | null;
  channelNum: string;
  channelMultiplier: number;
  channelTypeGid: number | null;
  parentChannelNum: string | null;
  type: string;
}

export interface DeviceConnected {
  deviceGid: number;
  connected: boolean;
  offlineSince: string | null;
}

export interface Outlet {
  deviceGid: number;
  outletOn: boolean;
  loadGid: number;
}

export interface EvCharger {
  deviceGid: number;
  loadGid: number;
  message: string;
  status: string;
  icon: string;
  iconLabel: string;
  debugCode: string;
  iconDetailText: string;
  faultText: string | null;
  proControlCode: string | null;
  breakerPIN: string | null;
  chargerOn: boolean;
  chargingRate: number;
  maxChargingRate: number;
  loadManagementEnabled: boolean;
  hideChargeRateSliderText: string | null;
}

export interface Battery {
  deviceGid: number;
  loadGid: number;
  capacityKWh: number;
  inverterMaxPowerKW: number;
  maxActivePowerKW: number;
  emsSN: string;
  emsVersion: string;
  inverterSN: string;
  inverterVersion: string;
  status: string;
  solarIcon: string;
  batteryIcon: string;
  gridIcon: string;
  powerFlow: any[];
  allowExport: boolean;
  hasSolar: boolean;
  onlyChargeFromExcessSolar: boolean;
  reserveStateOfCharge: number;
  stateOfCharge: number;
  batteryPowerKW: number;
  chargePowerKW: number;
  dischargePowerKW: number;
  inverterPowerKW: number;
  gridPowerKW: number;
  powerFromGridKW: number;
  powerToGridKW: number;
  pvPowerKW: number;
  loadPowerKW: number;
  peakStatus: string;
  peakRateKW: number;
  offPeakStatus: string;
  offPeakRateKW: number;
  offPeakEndChargeDuration: string;
  offPeakEndChargeRateKW: number;
  batteryControllable: boolean;
  maxGridPowerKW: number;
}

export interface NestedDevice {
  deviceGid: number;
  manufacturerDeviceId: string;
  model: string;
  firmware: string | null;
  channels: Channel[];
}

export interface EmporiaDevice {
  deviceGid: number;
  manufacturerDeviceId: string;
  model: string;
  firmware: string | null;
  parentDeviceGid: number | null;
  parentChannelNum: string | null;
  locationProperties: LocationProperties;
  outlet: Outlet | null;
  evCharger: EvCharger | null;
  battery: Battery | null;
  deviceConnected: DeviceConnected;
  devices: NestedDevice[];
  channels: Channel[];
}

export interface CustomerDevicesResponse {
  customerGid: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  devices: EmporiaDevice[];
}

export interface UsageDataPoint {
  [key: string]: any; // Usage data point structure varies by scale
}

export interface EvseResponse {
  success: Array<{
    deviceGid: string;
    charger_on: boolean;
    charge_rate_amps: number;
    max_charge_rate_amps: number;
    vehicle_connected: boolean;
    vehicle_charging: boolean;
    [key: string]: any; // Other properties from the EVSE schema
  }>;
  error: Array<{
    deviceGid: string;
    [key: string]: any; // Error details
  }>;
}

// EVSE Energy Response from OpenAPI spec
export interface EnergyDataPoint {
  start_time: string;
  end_time: string;
  value: number;
}

export interface DeviceEnergyData {
  device_gid: string;
  device_name: string;
  unit: string;
  data: EnergyDataPoint[];
}

export interface EnergyResponse {
  devices: DeviceEnergyData[];
}

// EVSE Power Response from OpenAPI spec
export interface PowerDataPoint {
  start_time: string;
  end_time: string;
  value: number;
}

export interface DevicePowerData {
  device_gid: string;
  device_name: string;
  unit: string;
  data: PowerDataPoint[];
}

export interface PowerResponse {
  devices: DevicePowerData[];
}

// New EVSE Energy Usage Response model matching the example response
export interface EnergyInterval {
  start: string;
  end: string;
}

export interface EnergyUsagePoint {
  interval: EnergyInterval;
  energy_kwhs: number;
  partial: boolean;
}

export interface DeviceEnergyUsage {
  device_id: string;
  usages: EnergyUsagePoint[];
}

export interface EVSEEnergyUsageResponse {
  energy_resolution: string;
  success: DeviceEnergyUsage[];
  error: any[];
}

// New response format for EVSE energy/power usage
export interface EVSEUsageResponse {
  energy_resolution?: string;
  power_resolution?: string;
  success: Array<{
    device_id: string;
    usages: Array<{
      interval: {
        start: string;
        end: string;
      };
      energy_kwhs?: number;
      power_watts?: number;
      partial: boolean;
    }>;
  }>;
  error: any[];
}

// Parameter types for API methods
export interface GetEVChargerEnergyUsageParams {
  device_ids: string[];
  start: string;
  end: string;
  energy_resolution: MeteredTimeResolution;
}

// Individual EVSE setting for a single device
export interface EVSESettingItem {
  device_id: string;
  charger_on: boolean;
  charge_rate_amps: number;
}

// PARTNER ENDPOINT
// Parameters for UpdateEVChargerSettings method
// export interface UpdateEVChargerSettingsParams {
//   settings: EVSESettingItem[];
// }

// The response structure for the settings update
export interface DevicesIdResponse {
  // Based on the schema, we're expecting a success response
  success: boolean;
  message?: string;
}

// Energy Monitor Circuit Energy Response interfaces
export interface CircuitEnergyInterval {
  start: string;
  end: string;
}

export interface CircuitEnergyUsagePoint {
  interval: CircuitEnergyInterval;
  energy_kwhs: number;
  partial: boolean;
}

export interface CircuitEnergyUsage {
  device_id: string;
  circuit_id: string;
  circuit_name: string;
  usages: CircuitEnergyUsagePoint[];
}

export interface CircuitEnergyResponse {
  energy_resolution: string;
  success: CircuitEnergyUsage[];
  error: any[];
}

// Energy Monitor Circuit Power Response interfaces
export interface CircuitPowerInterval {
  start: string;
  end: string;
}

export interface CircuitPowerUsagePoint {
  interval: CircuitPowerInterval;
  power_watts: number;
  partial: boolean;
}

export interface CircuitPowerUsage {
  device_id: string;
  circuit_id: string;
  circuit_name: string;
  usages: CircuitPowerUsagePoint[];
}

export interface CircuitPowerResponse {
  power_resolution: string;
  success: CircuitPowerUsage[];
  error: any[];
}

// Parameter types for Energy Monitor API methods
export interface GetEnergyMonitorEnergyUsageParams {
  device_ids: string[];
  circuit_ids: string[];
  start: string;
  end: string;
  energy_resolution: MeteredTimeResolution;
}

// Parameter types for Smart Plug API methods
export interface GetSmartPlugEnergyUsageParams {
  device_ids: string[];
  start: string;
  end: string;
  energy_resolution: MeteredTimeResolution;
}

// Device Channels response interfaces based on OpenAPI schema
export interface DeviceChannel {
  channelNum?: string;
  name?: string;
  channelTypeGid?: number;
  deviceGid?: number;
  parentChannelNum?: string | null;
  mainBranchCircuit?: boolean;
  combined?: boolean;
  mergedBranch?: boolean;
  hasData?: boolean;
  childChannelNums?: string[];
  type?: string;
}

export interface DeviceChannelsItem {
  device_gid: number;
  channels: DeviceChannel[];
}

export interface DeviceChannelData {
  channelNum?: string;
  name?: string;
  channelTypeGid?: number;
  deviceGid?: number;
  parentChannelNum?: string | null;
  mainBranchCircuit?: boolean;
  combined?: boolean;
  mergedBranch?: boolean;
  hasData?: boolean;
  childChannelNums?: string[];
  type?: string;
}

export interface DeviceChannels {
  deviceGid: number;
  manufacturerDeviceId: string;
  model: string;
  locationProperties: LocationProperties;
  channels: DeviceChannelData[];
  deviceConnected: DeviceConnected;
}

export interface DeviceChannelsResponse {
  devices: DeviceChannels[];
}

// Energy Monitor Response interfaces based on OpenAPI spec
export interface DeviceIdError {
  deviceGid: string;
  message: string;
}

export interface EnergyMonitor {
  deviceGid: string;
  model: string;
  firmware: string;
  name: string;
  connected: boolean;
  channelCount: number;
  mainBranchCircuits: number;
  [key: string]: any; // Other properties that might be present
}

export interface EnergyMonitorsResponse {
  success: EnergyMonitor[];
  error: DeviceIdError[];
}

// New Outlet Response types based on OpenAPI spec
export interface OutletDevice {
  deviceGid: string;
  outlet_on: boolean;
  [key: string]: any; // Other properties from the Device and EnergyManagementSettings schema
}

export interface OutletsResponse {
  success: OutletDevice[];
  error: DeviceIdError[];
}

// Battery Response interfaces based on OpenAPI spec
export interface BatteryDevice {
  deviceGid: string;
  capacityKWh: number;
  inverterMaxPowerKW: number;
  maxActivePowerKW: number;
  stateOfCharge: number;
  batteryPowerKW: number;
  hasSolar: boolean;
  allowExport: boolean;
  status: string;
  [key: string]: any; // Other properties from the Battery schema
}

export interface BatteriesResponse {
  success: BatteryDevice[];
  error: DeviceIdError[];
}

// Battery Energy Usage Response interfaces
export interface EnergyUsage {
  interval: {
    start: string;
    end: string;
  };
  energy_kwhs: number;
  partial: boolean;
}

export interface BatteryCircuitEnergyUsage {
  circuit_id: string;
  usage: EnergyUsage[];
}

export interface BatteryCircuitEnergyUsages {
  device_id: string;
  circuit_usages: BatteryCircuitEnergyUsage[];
}

export interface BatteryEnergyResponse {
  energy_resolution: string;
  success: BatteryCircuitEnergyUsages[];
  error: DeviceIdError[];
}

// Battery Power Usage Response interfaces
export interface PowerUsage {
  interval: {
    start: string;
    end: string;
  };
  power_watts: number;
  partial: boolean;
}

export interface BatteryCircuitPowerUsage {
  circuit_id: string;
  power: PowerUsage[];
}

export interface BatteryCircuitPowerUsages {
  device_id: string;
  circuit_power: BatteryCircuitPowerUsage[];
}

export interface BatteryPowerResponse {
  power_resolution: string;
  success: BatteryCircuitPowerUsages[];
  error: DeviceIdError[];
}

// Battery State of Charge Response interfaces
export interface StateOfCharge {
  interval: {
    start: string;
    end: string;
  };
  average_state_of_charge: number;
  partial: boolean;
}

export interface StateOfCharges {
  device_id: string;
  values: StateOfCharge[];
}

export interface StateOfChargeResponse {
  state_of_charge_resolution: string;
  success: StateOfCharges[];
  error: DeviceIdError[];
}

// EV Charging Report Response interfaces
export interface OpenInterval {
  start: string;
  end?: string;
}

export interface Interval {
  start: string;
  end: string;
}

export interface EVChargingSession {
  interval: OpenInterval;
  energy_kwhs?: number;
  charging_cost?: number;
  savings?: number;
  potential_savings?: number;
}

export interface EVPlugInSession {
  interval: OpenInterval;
  charging_sessions: EVChargingSession[];
}

export interface DailyChargingTotal {
  date: string;
  energy_kwhs?: number;
  charging_cost?: number;
  savings?: number;
  potential_savings?: number;
}

export interface EVChargingReportResponse {
  device_id: string;
  interval: Interval;
  report_description?: string;
  call_to_action_type?: "SET_TIMEZONE" | "SET_UTILITY_RATE" | "SET_SCHEDULE";
  energy_kwhs?: number;
  charging_cost?: number;
  daily_charging_totals: DailyChargingTotal[];
  plug_in_sessions: EVPlugInSession[];
}

// PARTNER ENDPOINT

// Parameter types for Battery API methods
export interface GetBatteryEnergyUsageParams {
  device_ids: string[];
  start: string;
  end: string;
  energy_resolution: MeteredTimeResolution;
}

export interface GetBatteryStateOfChargeParams {
  device_ids: string[];
  start: string;
  end: string;
  state_of_charge_resolution: MeteredTimeResolution;
}

// Parameter types for EV Charging Report API methods
export interface GetEVChargingReportParams {
  device_id: string;
  start: string;
  end: string;
}

// Parameter types for EV Charger Sessions API methods
export interface GetEVChargerSessionsParams {
  device_ids: string[];
  start: string;
  end: string;
}

// EV Charger Sessions Response interfaces
export interface EVSEChargingSession {
  interval: OpenInterval;
  energy_kwhs?: number;
}

export interface EVSESession {
  plug_in: string;
  plug_out?: string;
  sessions?: EVSEChargingSession[];
}

export interface EVSESessions {
  device_id: string;
  sessions: EVSESession[];
}

export interface EVSEsSessionsResponse {
  success: EVSESessions[];
  error: DeviceIdError[];
}

// Device summary type for listDevices() response (no channels, no raw_data)
export interface DeviceSummary {
  id: number;
  manufacturerDeviceId: string;
  model: string;
  firmwareVersion: string | null;
  name: string;
  connected: boolean;
  offlineSince: string | null;
  type: string;
  locationProperties: LocationProperties;
  deviceDetails: {
    evCharger: EvCharger | null;
    smartPlug: Outlet | null;
    battery: Battery | null;
  };
}

export interface ListDevicesResponse {
  customerInfo: {
    customerGid: number;
    email: string;
    name: string | null;
    createdAt: string;
  };
  deviceCount: number;
  devices: DeviceSummary[];
}

// Add a consolidated type for the getDevicePowerUsage tool
export type PowerResolution = "MINUTES" | "FIFTEEN_MINUTES";
export interface GetDevicePowerUsageParams {
  device_ids: string[];
  start: string;
  end: string;
  power_resolution: PowerResolution;
  circuit_ids: string[];
}

// Add a consolidated type for the getDeviceEnergyUsage tool
export interface GetDeviceEnergyUsageParams {
  device_ids: string[];
  start: string;
  end: string;
  energy_resolution: MeteredTimeResolution;
  circuit_ids: string[];
}

export type DeviceType = "vue1" | "vue2" | "vue3" | "vueutility" | "smartplug" | "evse" | "battery";

export interface DeviceTypeConfig {
  type: DeviceType;
  endpoint: string;
  responseType: string;
  firstChars: string[];
}
