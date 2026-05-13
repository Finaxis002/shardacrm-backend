/**
 * Parse pagination parameters from request query
 * @param {Object} options - Pagination options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 10)
 * @returns {Object} Pagination object with skip, limit, page
 */
export const parsePagination = ({ page, limit }) => {
  const pageNum = parseInt(page, 10) || 1;
    const pageLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * pageLimit;

  return { skip, limit: pageLimit, page: pageNum };
};

/**
 * Format paginated response
 * @param {Array} data - Array of items
 * @param {number} total - Total number of items
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {Object} Formatted paginated response
 */
export const formatPaginatedResponse = (data, total, page, limit) => {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1,
    },
  };
};

/**
 * Simple paginate helper for mongoose queries
 * @param {MongooseQuery} query - Mongoose query object
 * @param {number} limit - Items per page
 * @param {number} page - Page number
 * @returns {Object} { skip, limit }
 */
export const paginate = (query, limit = 10, page = 1) => {
  const skip = (page - 1) * limit;
  return { skip, limit, page };
};
