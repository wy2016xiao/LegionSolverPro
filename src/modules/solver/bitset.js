/** 创建可容纳指定格子数的紧凑位图。 */
function createMask(bitCount) {
    return new Uint32Array(Math.ceil(bitCount / 32));
}

/** 复制位图，供搜索分支独立修改。 */
function cloneMask(mask) {
    return mask.slice();
}

/** 把指定格设置为占用。 */
function setBit(mask, index) {
    mask[index >>> 5] |= (1 << (index & 31)) >>> 0;
}

/** 判断指定格是否已设置。 */
function hasBit(mask, index) {
    return (mask[index >>> 5] & ((1 << (index & 31)) >>> 0)) !== 0;
}

/** 判断两个位图是否存在共同格。 */
function intersects(left, right) {
    for (let index = 0; index < left.length; index++) {
        if ((left[index] & right[index]) !== 0) {
            return true;
        }
    }
    return false;
}

/** 把 source 原地合并进 target，避免搜索热路径产生额外数组。 */
function unionInto(target, source) {
    for (let index = 0; index < target.length; index++) {
        target[index] |= source[index];
    }
    return target;
}

/** 统计位图中的已设置格数。 */
function popcount(mask) {
    let total = 0;
    for (const word of mask) {
        let value = word >>> 0;
        value -= (value >>> 1) & 0x55555555;
        value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
        total += (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
    return total;
}

/** 生成适合失败状态缓存的确定性键。 */
function maskKey(mask) {
    return Array.from(mask, word => word.toString(36)).join('.');
}

export {
    cloneMask,
    createMask,
    hasBit,
    intersects,
    maskKey,
    popcount,
    setBit,
    unionInto,
};
