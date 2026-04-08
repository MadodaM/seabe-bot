// services/localScanner.js
const Jimp = require('jimp');
const { MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = require('@zxing/library/cjs');

/**
 * Decodes a barcode from an image buffer entirely locally (No API costs)
 * @param {Buffer} imageBuffer 
 * @returns {Promise<string|null>} The barcode string, or null if unreadable
 */
async function decodeBarcode(imageBuffer) {
    try {
        // 1. Read the image into a raw bitmap using Jimp
        const image = await Jimp.read(imageBuffer);
        
        // 2. Convert the bitmap into the format ZXing expects
        const source = new RGBLuminanceSource(image.bitmap.data, image.bitmap.width, image.bitmap.height);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(source));
        
        // 3. Scan for any standard barcode format
        const reader = new MultiFormatReader();
        const result = reader.decode(binaryBitmap);
        
        return result.getText();
    } catch (error) {
        // ZXing throws an error if it simply cannot find a barcode in the image
        return null; 
    }
}

module.exports = { decodeBarcode };