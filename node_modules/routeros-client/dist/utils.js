"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashedCaseToSnakeCase = exports.dashedCaseToCamelCase = exports.camelCaseOrSnakeCaseToDashedCase = exports.lookForIdParameterAndReturnItsValue = void 0;
/**
 * For for any .id search on the query and return it
 *
 * @param queries array of transformed query
 */
function lookForIdParameterAndReturnItsValue(queries) {
    let val = null;
    for (const query of queries) {
        if (query.includes("numbers=") || query.includes(".id=")) {
            val = query.split("=").pop();
        }
    }
    return val;
}
exports.lookForIdParameterAndReturnItsValue = lookForIdParameterAndReturnItsValue;
/**
 * Transform camelCase or snake_case to dashed-case,
 * so the routerboard can understand the parameters used
 * on this wrapper
 *
 * @param val to string to transform
 */
function camelCaseOrSnakeCaseToDashedCase(val) {
    // Clean any empty space left
    return val.replace(/ /g, "")
        // Convert camelCase to dashed
        .replace(/([a-z][A-Z])/g, (g, w) => {
        return g[0] + "-" + g[1].toLowerCase();
    })
        // Replace any underline to hiphen if used
        .replace(/_/g, "-");
}
exports.camelCaseOrSnakeCaseToDashedCase = camelCaseOrSnakeCaseToDashedCase;
/**
 * Transform routerboard's dashed-case to camelCase
 * so we can use objects properties without having to wrap
 * around quotes
 *
 * @param val the string to transform
 */
function dashedCaseToCamelCase(val) {
    return val.replace(/-([a-z])/g, (g) => {
        return g[1].toUpperCase();
    });
}
exports.dashedCaseToCamelCase = dashedCaseToCamelCase;
/**
 * Transform routerboard's dashed-case to snake_case
 * so we can use objects properties without having to wrap
 * around quotes
 *
 * @param val the string to transform
 */
function dashedCaseToSnakeCase(val) {
    return val.replace(/-/g, "_");
}
exports.dashedCaseToSnakeCase = dashedCaseToSnakeCase;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUE7Ozs7R0FJRztBQUNILFNBQWdCLG1DQUFtQyxDQUFDLE9BQWlCO0lBQ2pFLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQztJQUNmLEtBQUssTUFBTSxLQUFLLElBQUksT0FBTyxFQUFFO1FBQ3pCLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxFQUFFO1lBQ3RELEdBQUcsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1NBQ2hDO0tBQ0o7SUFDRCxPQUFPLEdBQUcsQ0FBQztBQUNmLENBQUM7QUFSRCxrRkFRQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQWdCLGdDQUFnQyxDQUFDLEdBQVc7SUFDeEQsNkJBQTZCO0lBQzdCLE9BQU8sR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO1FBQ3hCLDhCQUE4QjtTQUM3QixPQUFPLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQy9CLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDM0MsQ0FBQyxDQUFDO1FBQ0YsMENBQTBDO1NBQ3pDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDNUIsQ0FBQztBQVRELDRFQVNDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBZ0IscUJBQXFCLENBQUMsR0FBVztJQUM3QyxPQUFPLEdBQUcsQ0FBQyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUU7UUFDbEMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDOUIsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBSkQsc0RBSUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFnQixxQkFBcUIsQ0FBQyxHQUFXO0lBQzdDLE9BQU8sR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDbEMsQ0FBQztBQUZELHNEQUVDIn0=