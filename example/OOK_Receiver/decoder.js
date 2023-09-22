/**
 * Converts a hex string to a Uint8Array.
 * 
 * @param {string} hexString - The hex string to convert.
 * @returns {Uint8Array} - The resulting Uint8Array.
 */
function hexStringToUint8Array(hexString) {
    const arr = [];
    for (let i = 0; i < hexString.length; i += 2) {
      arr.push(parseInt(hexString.substr(i, 2), 16));
    }
    return new Uint8Array(arr);
  }

/**
 * Gets the channel based on the high 2 bits of the input byte.
 * 
 * @param {number} byte - An 8-bit unsigned integer representing the byte.
 * @returns {string} - A string representing the channel.
 */
function acuriteGetChannel(byte) {
    const channelStrs = ["C", "E", "B", "A"]; // 'E' stands for error
  
    const channel = (byte & 0xC0) >> 6;
    return channelStrs[channel];
  }

  
/**
 * Acurite Tower sensor decoder.
 * 
 * @param {string} hexString - A hex string representation of 7 bytes containing sensor data.
 * @returns {Object} - An object containing decoded sensor data.
 */
function acuriteTowerDecode(bb) {

    // Initialize variables
    let exception = 0;
    const channelStr = acuriteGetChannel(bb[0]); // Assuming acuriteGetChannel is defined elsewhere
    const sensorId = ((bb[0] & 0x3F) << 8) | bb[1];
    const batteryLow = (bb[2] & 0x40) === 0;
    const humidity = (bb[3] & 0x7F);

    // Sanity check for humidity
    if (humidity > 100 && humidity !== 127) {
        console.log(`Invalid humidity: ${humidity} %rH`);
        return { status: 'DECODE_FAIL_SANITY' };
    }

    // Decode temperature
    const tempRaw = ((bb[4] & 0x7F) << 7) | (bb[5] & 0x7F);
    const tempC = (tempRaw - 1000) * 0.1;

    // Sanity check for temperature
    if (tempC < -40 || tempC > 70) {
        console.log(`Invalid temperature: ${tempC.toFixed(2)} C`);
        return { status: 'DECODE_FAIL_SANITY' };
    }

    // Check for exception in temperature bits 12-14
    if ((tempRaw & 0x3800) !== 0) {
        exception++;
    }

    // Create data object
    const data = {
        model: 'Acurite-Tower',
        id: sensorId,
        channel: channelStr,
        battery_ok: !batteryLow,
        temperature_C: tempC.toFixed(1),
        humidity: humidity !== 127 ? humidity : null,
        mic: 'CHECKSUM',
        raw_bytes: hexString
    };

    // Append exception if any
    if (exception) {
        data.exception = exception;
    }

    return data;
}

function fineoffsetWS80Decode(bb) {
    // Initialize variables
    const id = (bb[1] << 16) | (bb[2] << 8) | bb[3];
    const lightRaw = (bb[4] << 8) | bb[5];
    const lightLux = lightRaw * 10;
    const batteryMv = bb[6] * 20;
    const batteryLvl = batteryMv < 1400 ? 0 : (batteryMv - 1400) / 16;
    const flags = bb[7];
    const tempRaw = ((bb[7] & 0x03) << 8) | bb[8];
    const tempC = (tempRaw - 400) * 0.1;
    const humidity = bb[9];
    const windAvg = ((bb[7] & 0x10) << 4) | bb[10];
    const windDir = ((bb[7] & 0x20) << 3) | bb[11];
    const windMax = ((bb[7] & 0x40) << 2) | bb[12];
    const uvIndex = bb[13];
    const unknown = (bb[14] << 8) | bb[15];

    // Create data object
    const data = {
        model: 'Fineoffset-WS80',
        id: id.toString(16),
        battery_ok: batteryLvl * 0.01,
        battery_mV: `${batteryMv} mV`,
        temperature_C: tempRaw !== 0x3ff ? tempC.toFixed(1) : null,
        humidity: humidity !== 0xff ? humidity : null,
        wind_dir_deg: windDir !== 0x1ff ? windDir : null,
        wind_avg_m_s: windAvg !== 0x1ff ? (windAvg * 0.1).toFixed(1) : null,
        wind_max_m_s: windMax !== 0x1ff ? (windMax * 0.1).toFixed(1) : null,
        uvi: uvIndex !== 0xff ? (uvIndex * 0.1).toFixed(1) : null,
        light_lux: lightRaw !== 0xffff ? lightLux.toFixed(1) : null,
        flags: flags.toString(16),
        unknown: unknown !== 0x3fff ? unknown : null,
        mic: 'CRC',
        raw_bytes: Array.from(bb).map(b => b.toString(16)).join('')
    };

    return data;
}

function fineoffsetWH45Decode(bb) {
    // Initialize variables
    const id = (bb[1] << 16) | (bb[2] << 8) | bb[3];
    const tempRaw = (bb[4] & 0x7) << 8 | bb[5];
    const tempC = (tempRaw - 400) * 0.1;
    const humidity = bb[6];
    const batteryBars = (bb[7] & 0x40) >> 4 | (bb[9] & 0xC0) >> 6;
    const extPower = batteryBars === 6 ? 1 : 0;
    const batteryOk = Math.min(batteryBars * 0.2, 1.0);
    const pm25Raw = (bb[7] & 0x3f) << 8 | bb[8];
    const pm25 = pm25Raw * 0.1;
    const pm10Raw = (bb[9] & 0x3f) << 8 | bb[10];
    const pm10 = pm10Raw * 0.1;
    const co2 = (bb[11] << 8) | bb[12];

    // Create data object
    const data = {
        model: 'Fineoffset-WH45',
        id: id.toString(16),
        battery_ok: batteryOk.toFixed(1),
        temperature_C: tempC.toFixed(1),
        humidity: humidity,
        pm2_5_ug_m3: pm25.toFixed(1),
        pm10_ug_m3: pm10.toFixed(1),
        co2_ppm: co2,
        ext_power: extPower,
        mic: 'CRC',
        raw_bytes: Array.from(bb).map(b => b.toString(16)).join('')
    };

    return data;
}

FINEOFFSET_MSGTYPE_WS80 = 0x80;
FINEOFFSET_MSGTYPE_WH45 = 0x45;
ACURITE_MSGTYPE_TOWER_SENSOR = 0x04;

function decode(hexString) {
    const bb = hexStringToUint8Array(hexString);

    // Assuming these will be unique identifiers for each sensor type, but this may not be true
    const acurite_message_type = bb[2] & 0x3f;
    const fineoffset_message_type = bb[0];

    if (acurite_message_type === ACURITE_MSGTYPE_TOWER_SENSOR) {
        return acuriteTowerDecode(bb);
    } else if (fineoffset_message_type === FINEOFFSET_MSGTYPE_WS80) {  
        return fineoffsetWS80Decode(bb);
    } else if (fineoffset_message_type === FINEOFFSET_MSGTYPE_WH45) {  
        return fineoffsetWH45Decode(bb);
    } else {
        console.log(`Unsupported message type: ${message_type}`);
        return { status: 'DECODE_FAIL_UNSUPPORTED' };
    }
}

// Example usage
//const hexString = "de7044af0a81cc";
//const hexString = "80002d980000950a764005bc0a003fff973a";
const hexString = "45003fd102a2360040c04701a193ab";
const decodedData = decode(hexString);
console.log(decodedData);
  